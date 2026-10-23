import { Body, Controller, Delete, Get, HttpCode, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { NotificationWebhookService } from './notification-webhook.service';
import { RegisterNotificationWebhookDto } from './dto/register-notification-webhook.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('merchants/me/notification-webhook')
export class NotificationWebhookController {
  constructor(private readonly notificationWebhooks: NotificationWebhookService) {}

  @Put()
  @ApiOperation({ summary: 'Register or replace the notification webhook URL' })
  register(
    @Request() req: { user: { merchantId: string } },
    @Body() dto: RegisterNotificationWebhookDto,
  ) {
    return this.notificationWebhooks.register(req.user.merchantId, dto.url, dto.secret);
  }

  @Get()
  @ApiOperation({ summary: 'Get the registered notification webhook' })
  get(@Request() req: { user: { merchantId: string } }) {
    return this.notificationWebhooks.get(req.user.merchantId);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the notification webhook' })
  remove(@Request() req: { user: { merchantId: string } }) {
    return this.notificationWebhooks.remove(req.user.merchantId);
  }
}
