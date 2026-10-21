import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { EmailLog } from './entities/email-log.entity';
import { EmailService, EMAIL_QUEUE } from './email.service';
import { EmailProcessor } from './email.processor';
import { NodemailerService } from './nodemailer.service';
import { EmailAdminController } from './email-admin.controller';
import { NotificationTemplate, NotificationTemplateVersion } from './entities/notification-template.entity';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTemplateAdminController } from './notification-template-admin.controller';
import { emailConfig } from '../config/email.config';
import { RetryModule } from '../retry/retry.module';

@Module({
  imports: [
    ConfigModule.forFeature(emailConfig),
    TypeOrmModule.forFeature([EmailLog, NotificationTemplate, NotificationTemplateVersion]),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    RetryModule,
  ],
  providers: [EmailService, EmailProcessor, NodemailerService, NotificationTemplateService],
  controllers: [EmailAdminController, NotificationTemplateAdminController],
  exports: [EmailService],
})
export class EmailModule {}
