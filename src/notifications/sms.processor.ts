import { Injectable, Logger } from "@nestjs/common";
import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { SMS_DELIVERY_JOB, SMS_DELIVERY_QUEUE } from "../queues/queue.constants";

export interface SmsJobPayload {
  to: string;
  body: string;
}

/**
 * Sends SMS through Twilio's Messages REST API. Rate limiting is applied by the
 * queue (see `NotificationsModule`), not here.
 */
@Injectable()
@Processor(SMS_DELIVERY_QUEUE)
export class SmsProcessor {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(private readonly configService: ConfigService) {}

  @Process(SMS_DELIVERY_JOB)
  async process(job: Job<SmsJobPayload>): Promise<void> {
    const accountSid = this.configService.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.configService.get<string>("TWILIO_AUTH_TOKEN");
    const from = this.configService.get<string>("TWILIO_FROM_NUMBER");
    if (!accountSid || !authToken || !from) {
      throw new Error("Twilio configuration is incomplete");
    }

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({ To: job.data.to, From: from, Body: job.data.body }),
      { auth: { username: accountSid, password: authToken }, timeout: 10000 },
    );

    // Log the Twilio message SID only; the destination number is PII
    this.logger.log(`SMS sent attempt=${job.attemptsMade + 1} sid=${response.data.sid}`);
  }
}
