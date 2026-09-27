import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import * as crypto from 'crypto';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from "../queue/queue.constants";
import { QueueConfigService } from "../config/queue-config.service";
import { Webhook } from "./entities/webhook.entity";

interface WebhookDeliveryPayload {
  webhookId: string;
  merchantId: string;
  url: string;
  secret: string;
  event: string;
  body: string;
  attemptNumber: number;
}

@Injectable()
export class WebhookDeliveryService {
  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly webhookQueue: Queue,
    private readonly queueConfig: QueueConfigService,
  ) {}

  private buildJobId(webhookId: string, event: string, body: string, attemptNumber = 1): string {
    const hash = crypto.createHash('sha256').update(`${webhookId}:${event}:${attemptNumber}:${body}`).digest('hex').slice(0, 32);
    return `${webhookId}:${event}:${attemptNumber}:${hash}`;
  }

  async enqueueDelivery(
    webhook: Webhook,
    event: string,
    body: string,
  ): Promise<void> {
    const jobPayload: WebhookDeliveryPayload = {
      webhookId: webhook.id,
      merchantId: webhook.merchantId,
      url: webhook.url,
      secret: webhook.secret ?? "",
      event,
      body,
      attemptNumber: 1,
    };

    await this.webhookQueue.add(WEBHOOK_DELIVERY_JOB, jobPayload, {
      jobId: this.buildJobId(webhook.id, event, body, 1),
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
