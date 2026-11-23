import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import {
  EMAIL_DELIVERY_JOB,
  EMAIL_DELIVERY_QUEUE,
  SMS_DELIVERY_JOB,
  SMS_DELIVERY_QUEUE,
} from "../queues/queue.constants";
import { QueueConfigService } from "../config/queue-config.service";
import { SmsJobPayload } from "./sms.processor";

export interface EmailJobPayload {
  recipient: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface MerchantPaymentConfirmedPayload {
  merchantEmail: string;
  merchantName?: string;
  paymentId: string;
  reference?: string;
  amountUsd?: string | number;
  amountUsdc?: string | number;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(EMAIL_DELIVERY_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(SMS_DELIVERY_QUEUE) private readonly smsQueue: Queue,
    private readonly queueConfig: QueueConfigService,
  ) {}

  async enqueueEmail(payload: EmailJobPayload): Promise<void> {
    await this.emailQueue.add(EMAIL_DELIVERY_JOB, payload, {
      attempts: this.queueConfig.emailMaxRetries + 1,
      backoff: { type: "fixed", delay: this.queueConfig.emailRetryDelay },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  /**
   * Notify a merchant that one of their payments was confirmed.
   * Callers are responsible for honouring the merchant's
   * `paymentConfirmedEmailEnabled` preference before calling this.
   */
  async notifyMerchant(payload: MerchantPaymentConfirmedPayload): Promise<void> {
    const amount = payload.amountUsd ?? payload.amountUsdc ?? "0";
    const reference = payload.reference ?? payload.paymentId;

    await this.enqueueEmail({
      recipient: payload.merchantEmail,
      subject: `Payment ${reference} confirmed`,
      text:
        `Hello ${payload.merchantName ?? "there"},\n\n` +
        `Payment ${reference} for ${amount} USDC has been confirmed.\n\n` +
        `— Dupdap`,
    });
  }

  async enqueueSms(payload: SmsJobPayload): Promise<void> {
    await this.smsQueue.add(SMS_DELIVERY_JOB, payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
