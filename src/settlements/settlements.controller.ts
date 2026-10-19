import { Controller, Get, Post, Query, UseGuards, Request, Body, HttpCode, HttpStatus, Param, Header, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiResponse,
  ApiHeader,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { SettlementsService, PartnerCallbackPayload } from './settlements.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PartnerSignatureGuard } from './guards/partner-signature.guard';

@ApiTags('settlements')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Get()
  @Scopes('settlements:read')
  @ApiOperation({ summary: 'List settlements' })
  @ApiOkResponse({ description: 'Paginated settlements' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing settlements:read scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  findAll(@Request() req: { user: { merchantId: string } }, @Query() pagination: PaginationDto) {
    return this.settlementsService.findAll(req.user.merchantId, pagination.page, pagination.limit);
  }

  @Get('export')
  @Scopes('settlements:read')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Export settlements as CSV (includes fee breakdown)' })
  @ApiOkResponse({ description: 'CSV export' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing settlements:read scope' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  exportCsv(@Request() req: { user: { merchantId: string } }) {
    return this.settlementsService.exportCsvForMerchant(req.user.merchantId);
  }

  @Get(':id/fee-breakdown')
  @Scopes('settlements:read')
  @ApiOperation({ summary: 'Settlement fee audit report' })
  @ApiParam({ name: 'id', description: 'Settlement UUID' })
  @ApiOkResponse({ description: 'Fee breakdown' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing settlements:read scope' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  getFeeBreakdown(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.settlementsService.getFeeBreakdown(req.user.merchantId, id);
  }
}

@ApiTags('settlements')
@Controller('settlements')
export class PartnerCallbackController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Post('partner-callback')
  @UseGuards(PartnerSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive fiat settlement status callback from partner API' })
  @ApiHeader({ name: 'X-Partner-Signature', description: 'HMAC-SHA256 signature of the request body', required: true })
  handleCallback(@Body() payload: PartnerCallbackPayload) {
    return this.settlementsService.handlePartnerCallback(payload);
  }
}
