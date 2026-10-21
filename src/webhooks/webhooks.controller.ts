import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiResponse,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ReplayWebhooksDto } from './dto/replay-webhooks.dto';

@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'List webhooks' })
  @ApiOkResponse({ description: 'Webhook subscriptions' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing webhooks:manage scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  findAll(@Request() req: { user: { merchantId: string } }) {
    return this.webhooksService.findAll(req.user.merchantId);
  }

  @Post()
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Create webhook' })
  @ApiCreatedResponse({ description: 'Webhook created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing webhooks:manage scope' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  create(@Request() req: { user: { merchantId: string } }, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(req.user.merchantId, dto.url, dto.events, dto.secret);
  }

  @Post('replay')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Replay missed webhook events (1 replay per 5 minutes)' })
  @ApiOkResponse({ description: 'Replay enqueued' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing webhooks:manage scope' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Replay rate limit exceeded' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  replay(@Request() req: { user: { merchantId: string } }, @Body() dto: ReplayWebhooksDto) {
    return this.webhooksService.replay(req.user.merchantId, dto);
  }

  @Post('test')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Send a signed test event to all active webhooks' })
  @ApiOkResponse({ description: 'Test deliveries enqueued' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing webhooks:manage scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  test(@Request() req: { user: { merchantId: string } }) {
    return this.webhooksService.sendTest(req.user.merchantId);
  }

  @Delete(':id')
  @Scopes('webhooks:manage')
  @ApiOperation({ summary: 'Delete webhook' })
  @ApiParam({ name: 'id', description: 'Webhook id' })
  @ApiOkResponse({ description: 'Deleted' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing webhooks:manage scope' })
  @ApiNotFoundResponse({ description: 'Webhook not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  remove(@Request() req: { user: { merchantId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.remove(id, req.user.merchantId);
  }
}
