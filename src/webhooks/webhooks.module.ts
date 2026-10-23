import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { AdminAlertModule } from '../alerts/admin-alert.module';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { Webhook } from './entities/webhook.entity';
import { WebhookDeliveryLog } from './entities/webhook-delivery-log.entity';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookFailureAlertService } from './webhook-failure-alert.service';
import { QueueConfigService } from '../config/queue-config.service';
import { WEBHOOK_DELIVERY_QUEUE } from '../queues/queue.constants';
import { Merchant } from '../merchants/entities/merchant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CacheModule } from '../cache/cache.module';
import { PrometheusModule } from '../prometheus/prometheus.module';
import { EmailModule } from '../email/email.module';
import { WebhookCircuitAdminController } from './webhook-circuit-admin.controller';
import { MerchantsModule } from '../merchants/merchants.module';
import { NotificationWebhookService } from './notification-webhook.service';
import { NotificationWebhookController } from './notification-webhook.controller';
import { PaymentNotificationSubscriber } from './payment-notification.subscriber';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Webhook, WebhookDeliveryLog, Merchant]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    AdminAlertModule,
    NotificationsModule,
    CacheModule,
    PrometheusModule,
    EmailModule,
    MerchantsModule,
  ],
  controllers: [WebhooksController, WebhookCircuitAdminController, NotificationWebhookController],
  providers: [WebhooksService, WebhookDeliveryProcessor, WebhookDeliveryService, WebhookFailureAlertService, QueueConfigService, NotificationWebhookService, PaymentNotificationSubscriber],
  exports: [WebhooksService, WebhookDeliveryService, NotificationWebhookService],
})
export class WebhooksModule {}
