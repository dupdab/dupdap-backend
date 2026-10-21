import { Controller, Get, Patch, Post, Body, UseGuards, Request, Query, Delete } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { UpdateMerchantDto } from './dto/create-merchant.dto';
import { UpdateSettlementPreferenceDto } from './dto/update-settlement-preference.dto';
import { GenerateApiKeyDto } from './dto/generate-api-key.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { UpdateNotificationPrefsDto, NotificationPrefsResponseDto } from '../notifications/dto/notification-prefs.dto';

@ApiTags('merchants')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly merchantsService: MerchantsService,
    private readonly notificationPrefsService: NotificationPrefsService,
  ) {}

  @Get('me')
  @Scopes('profile:read')
  @ApiOperation({ summary: 'Get merchant profile' })
  @ApiOkResponse({ description: 'Merchant profile' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing profile:read scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getProfile(@Request() req: { user: { merchantId: string } }) {
    return this.merchantsService.getProfile(req.user.merchantId);
  }

  @Patch('me')
  @Scopes('merchant:manage')
  @ApiOperation({ summary: 'Update merchant profile' })
  @ApiOkResponse({ description: 'Updated merchant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'Requires interactive JWT session — not reachable via API key' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  update(@Request() req: { user: { merchantId: string } }, @Body() dto: UpdateMerchantDto) {
    return this.merchantsService.update(req.user.merchantId, dto);
  }

  @Get('audit-log')
  @Scopes('profile:read')
  @ApiOperation({ summary: 'List merchant settings audit log (paginated)' })
  @ApiOkResponse({ description: 'Paginated audit entries' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  getAuditLog(
    @Request() req: { user: { merchantId: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.merchantsService.getAuditLog(
      req.user.merchantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('api-keys')
  @Scopes('merchant:manage')
  @ApiOperation({ summary: 'Generate API key' })
  @ApiOkResponse({ description: 'New API key payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'Requires interactive JWT session — not reachable via API key' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  generateApiKey(
    @Request() req: { user: { merchantId: string }; ip: string },
    @Body() dto: GenerateApiKeyDto,
  ) {
    return this.merchantsService.generateApiKey(
      req.user.merchantId,
      dto.scopes,
      dto.expiresAt,
      req.ip,
    );
  }

  @Delete('api-keys')
  @Scopes('merchant:manage')
  @ApiOperation({ summary: 'Revoke merchant API key' })
  revokeApiKey(@Request() req: { user: { merchantId: string }; ip: string }) {
    return this.merchantsService.revokeApiKey(req.user.merchantId, req.ip);
  }

  @Get('api-keys/audit')
  @Scopes('profile:read')
  @ApiOperation({ summary: 'List API key lifecycle audit events' })
  getApiKeyAudit(@Request() req: { user: { merchantId: string } }, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.merchantsService.getApiKeyAudit(req.user.merchantId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
  }

  @Patch('me/settings')
  @Scopes('merchant:manage')
  @ApiOperation({ summary: 'Update merchant settlement preference' })
  @ApiOkResponse({ description: 'Updated merchant settlement preference' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  updateSettings(
    @Request() req: { user: { merchantId: string } },
    @Body() dto: UpdateSettlementPreferenceDto,
  ) {
    return this.merchantsService.updateSettlementPreference(
      req.user.merchantId,
      dto.settlementFrequency,
    );
  }

  @Get('me/notification-prefs')
  @Scopes('notifications:read')
  @ApiOperation({ summary: 'Get notification preferences' })
  @ApiOkResponse({ type: NotificationPrefsResponseDto, description: 'Current notification preferences per channel and event' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing notifications:read scope' })
  getNotificationPrefs(
    @Request() req: { user: { merchantId: string } },
  ): Promise<NotificationPrefsResponseDto> {
    return this.notificationPrefsService.getPrefs(req.user.merchantId);
  }

  @Patch('me/notification-prefs')
  @Scopes('notifications:read')
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiOkResponse({ type: NotificationPrefsResponseDto, description: 'Updated notification preferences' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing notifications:read scope' })
  @ApiBadRequestResponse({ description: 'Validation failed or attempted to disable in_app channel' })
  updateNotificationPrefs(
    @Request() req: { user: { merchantId: string } },
    @Body() dto: UpdateNotificationPrefsDto,
  ): Promise<NotificationPrefsResponseDto> {
    return this.notificationPrefsService.updatePrefs(req.user.merchantId, dto);
  }
}

/** Compatibility route matching the merchant API key audit endpoint name. */
@ApiTags('merchant')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('merchant/api-keys')
export class MerchantApiKeyAuditController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get('audit')
  @Scopes('profile:read')
  @ApiOperation({ summary: 'List API key lifecycle audit events' })
  getApiKeyAudit(
    @Request() req: { user: { merchantId: string } },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.merchantsService.getApiKeyAudit(
      req.user.merchantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
