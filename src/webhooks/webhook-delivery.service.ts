import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import * as crypto from 'crypto';
import * as dns from 'dns';
import * as net from 'net';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
} from "../queues/queue.constants";
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
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly webhookQueue: Queue,
    private readonly queueConfig: QueueConfigService,
  ) {}

  private buildJobId(webhookId: string, event: string, body: string, attemptNumber = 1): string {
    const hash = crypto.createHash('sha256').update(`${webhookId}:${event}:${attemptNumber}:${body}`).digest('hex').slice(0, 32);
    return `${webhookId}:${event}:${attemptNumber}:${hash}`;
  }

  /**
   * Returns true when the given IP address is private, loopback, link-local,
   * or otherwise not a safe public destination for an outbound webhook call.
   */
  private isPrivateAddress(address: string): boolean {
    const version = net.isIP(address);
    if (version === 4) {
      const parts = address.split('.').map((p) => parseInt(p, 10));
      const [a, b] = parts;
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 127) return true; // 127.0.0.0/8 loopback
      if (a === 0) return true; // 0.0.0.0/8
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
      return false;
    }
    if (version === 6) {
      const normalized = address.toLowerCase();
      if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
      if (normalized.startsWith('fe80')) return true; // fe80::/10 link-local
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
      // IPv4-mapped IPv6 (::ffff:a.b.c.d)
      const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped) return this.isPrivateAddress(mapped[1]);
      return false;
    }
    return true; // not a valid IP -> reject
  }

  /**
   * Resolves the webhook hostname and rejects any private/loopback/link-local
   * destination before the outbound request is made (SSRF guard).
   */
  private async assertSafeUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid webhook URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(`Webhook URL must use https: ${rawUrl}`);
    }

    const hostname = parsed.hostname;
    const addresses: string[] = [];

    if (net.isIP(hostname)) {
      addresses.push(hostname);
    } else {
      const resolved = await dns.promises.lookup(hostname, { all: true });
      for (const entry of resolved) {
        addresses.push(entry.address);
      }
    }

    if (addresses.length === 0) {
      throw new Error(`Webhook host could not be resolved: ${hostname}`);
    }

    for (const address of addresses) {
      if (this.isPrivateAddress(address)) {
        throw new Error(
          `Webhook URL resolves to a private/loopback address (${address}); refusing to deliver`,
        );
      }
    }
  }

  async enqueueDelivery(
    webhook: Webhook,
    event: string,
    body: string,
  ): Promise<void> {
    try {
      await this.assertSafeUrl(webhook.url);
    } catch (error) {
      this.logger.warn(
        `Refusing to enqueue webhook delivery for ${webhook.id}: ${(error as Error).message}`,
      );
      return;
    }

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
