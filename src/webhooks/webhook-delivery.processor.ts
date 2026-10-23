import { Injectable, Logger, Optional } from "@nestjs/common";
import { Processor, Process, InjectQueue } from "@nestjs/bull";
import { Job, Queue } from "bull";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import * as crypto from "crypto";
import { ConfigService } from "@nestjs/config";
import { QueueConfigService } from "../config/queue-config.service";
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from "../queues/queue.constants";
import { Webhook } from "./entities/webhook.entity";
import { WebhookDeliveryLog } from "./entities/webhook-delivery-log.entity";
import { Merchant } from "../merchants/entities/merchant.entity";
import { WebhookFailureAlertService } from "./webhook-failure-alert.service";
import { MetricsService } from '../prometheus/metrics.service';
import { AdminAlertService } from '../alerts/admin-alert.service';
import { AdminAlertType } from '../alerts/admin-alert.entity';
import { EmailService } from '../email/email.service';

export const WEBHOOK_CIRCUIT_FAILURE_THRESHOLD = 5;
export const WEBHOOK_CIRCUIT_OPEN_MS = 24 * 60 * 60 * 1000;

interface WebhookDeliveryJobData {
  webhookId: string;
  merchantId: string;
  url: string;
  secret: string;
  event: string;
  body: string;
  attemptNumber: number;
  /** Set by bulk replay (#552); surfaced as the X-Webhook-Replay header. */
  replay?: boolean;
}

@Injectable()
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @InjectRepository(WebhookDeliveryLog)
    private readonly deliveryLogRepo: Repository<WebhookDeliveryLog>,
    @InjectRepository(Merchant)
    private readonly merchantRepo: Repository<Merchant>,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly webhookQueue: Queue,
    private readonly queueConfig: QueueConfigService,
    private readonly config: ConfigService,
    private readonly failureAlertService: WebhookFailureAlertService,
    private readonly adminAlerts: AdminAlertService,
    private readonly emailService: EmailService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  @Process(WEBHOOK_DELIVERY_JOB)
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const data = job.data;

    // Circuit breaker (#457): skip delivery while the endpoint's circuit is open.
    const current = await this.webhookRepo.findOne({ where: { id: data.webhookId } });
    if (current?.circuitOpenUntil && new Date(current.circuitOpenUntil).getTime() > Date.now()) {
      this.logger.warn(
        `Webhook circuit open for ${data.url} until ${new Date(current.circuitOpenUntil).toISOString()}; skipping delivery.`,
      );
      return;
    }

    const startedAt = Date.now();
    const requestBody = data.body;
    const signature = this.sign(requestBody, data.secret);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-webhook-signature": signature,
      "x-webhook-event": data.event,
    };
    if (data.replay) {
      headers["X-Webhook-Replay"] = "true";
    }

    try {
      const response = await axios.post(data.url, requestBody, {
        headers,
        timeout: 15000,
      });
      this.metrics?.webhookDeliveryDurationSeconds.observe(
        { event: data.event, status: 'success' }, (Date.now() - startedAt) / 1000,
      );

      await this.logDelivery(data, "success", response.status, undefined, 0);
      await this.markWebhookSuccess(data.webhookId);
    } catch (error) {
      this.metrics?.webhookDeliveryDurationSeconds.observe(
        { event: data.event, status: 'failure' }, (Date.now() - startedAt) / 1000,
      );
      const errorMessage = error?.response?.data
        ? JSON.stringify(error.response.data)
        : (error?.message ?? "Unknown error");
      const responseCode = error?.response?.status ?? null;
      const retrySchedule = this.queueConfig.webhookRetrySchedule;
      const attemptNumber = data.attemptNumber;
      const retryIndex = attemptNumber - 1;
      const nextDelay = retrySchedule[retryIndex] ?? 0;

      // A merchant webhook policy overrides the global webhook retry settings.
      let merchant: Merchant | null = null;
      try {
        merchant = await this.merchantRepo.findOne({ where: { id: data.merchantId } });
      } catch {
        merchant = null;
      }
      const merchantRetry = merchant?.webhookRetryConfig;
      const maxAttempts = merchantRetry?.maxAttempts ?? this.queueConfig.webhookMaxRetries;
      const retryDelay = merchantRetry
        ? merchantRetry.retryDelays[Math.min(retryIndex, merchantRetry.retryDelays.length - 1)]
        : nextDelay;

      await this.logDelivery(
        data,
        "failure",
        responseCode,
        errorMessage,
        retryDelay,
      );
      const circuitOpened = await this.markWebhookFailure(data.webhookId, errorMessage);

      if (circuitOpened) {
        this.logger.warn(`Webhook circuit opened for ${data.url}; no further retries scheduled.`);
      } else if (attemptNumber < maxAttempts) {
        const retryPayload = { ...data, attemptNumber: attemptNumber + 1 };
        const retryHash = crypto.createHash('sha256').update(`${data.webhookId}:${data.event}:${retryPayload.attemptNumber}:${data.body}`).digest('hex').slice(0, 32);

        await this.webhookQueue.add(
          WEBHOOK_DELIVERY_JOB,
          retryPayload,
          {
            jobId: `${data.webhookId}:${data.event}:${retryPayload.attemptNumber}:${retryHash}`,
            delay: retryDelay,
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      } else {
        this.logger.warn(
          `Webhook delivery exhausted retries for ${data.url} after ${attemptNumber} attempts.`,
        );
      }
    }
  }

  private sign(body: string, secret: string): string {
    return crypto
      .createHmac("sha256", secret ?? "")
      .update(body)
      .digest("hex");
  }

  private async logDelivery(
    data: WebhookDeliveryJobData,
    status: "success" | "failure",
    responseCode?: number,
    error?: string,
    retryDelayMs?: number,
  ) {
    const logEntry = this.deliveryLogRepo.create({
      webhookId: data.webhookId,
      event: data.event,
      requestUrl: data.url,
      requestBody: data.body,
      attemptNumber: data.attemptNumber,
      status,
      responseCode,
      error,
      retryDelayMs: retryDelayMs ?? 0,
    });
    await this.deliveryLogRepo.save(logEntry);
  }

  private async markWebhookSuccess(webhookId: string) {
    // Atomic write — avoids a read-modify-write race with concurrent deliveries.
    await this.webhookRepo.update(
      { id: webhookId },
      { failureCount: 0, lastDeliveredAt: new Date(), circuitOpenUntil: null },
    );
  }

  private async markWebhookFailure(webhookId: string, lastError: string): Promise<boolean> {
    // Atomic increment (UPDATE ... SET failureCount = failureCount + 1) so that
    // concurrent deliveries for the same webhook can't lose an increment to a
    // last-write-wins race and under-count towards the auto-deactivation threshold.
    const { affected } = await this.webhookRepo.increment(
      { id: webhookId },
      'failureCount',
      1,
    );
    if (!affected) return false;

    const webhook = await this.webhookRepo.findOne({
      where: { id: webhookId },
    });
    if (!webhook) return false;

    if (webhook.failureCount >= 10 && webhook.isActive) {
      await this.webhookRepo.update({ id: webhookId }, { isActive: false });
      webhook.isActive = false;
    }

    const merchant = await this.merchantRepo.findOne({
      where: { id: webhook.merchantId },
      select: ['email'],
    });
    if (merchant?.email) {
      const settingsUrl = `${this.config.get('FRONTEND_URL', '')}/dashboard/settings/webhooks`;
      await this.failureAlertService.notifyIfNeeded(webhook, merchant.email, lastError, settingsUrl);
    }

    return this.openCircuitIfNeeded(webhook, lastError);
  }

  /** Opens the circuit after N consecutive failures; alerts admins and emails the merchant. */
  private async openCircuitIfNeeded(webhook: Webhook, lastError: string): Promise<boolean> {
    const alreadyOpen =
      webhook.circuitOpenUntil && new Date(webhook.circuitOpenUntil).getTime() > Date.now();
    if (webhook.failureCount < WEBHOOK_CIRCUIT_FAILURE_THRESHOLD || alreadyOpen) {
      return false;
    }

    const reopensAt = new Date(Date.now() + WEBHOOK_CIRCUIT_OPEN_MS);
    await this.webhookRepo.update({ id: webhook.id }, { circuitOpenUntil: reopensAt });

    await this.adminAlerts.raise({
      type: AdminAlertType.WEBHOOK_FAILURE,
      dedupeKey: `webhook-circuit:${webhook.id}`,
      message: `Webhook circuit opened for merchant ${webhook.merchantId} endpoint ${webhook.url} after ${webhook.failureCount} consecutive failures.`,
      metadata: {
        webhookId: webhook.id,
        merchantId: webhook.merchantId,
        url: webhook.url,
        reopensAt: reopensAt.toISOString(),
        lastError,
      },
      thresholdValue: webhook.failureCount,
    });

    const merchant = await this.merchantRepo.findOne({ where: { id: webhook.merchantId } });
    if (merchant?.email) {
      await this.emailService.queue(
        merchant.email,
        'webhook-circuit-open',
        {
          subject: 'Webhook deliveries paused',
          businessName: merchant.businessName ?? '',
          url: webhook.url,
          failureCount: webhook.failureCount,
          reopensAt: reopensAt.toISOString(),
          lastError,
        },
        merchant.id,
      );
    }

    return true;
  }
}
