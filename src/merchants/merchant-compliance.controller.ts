import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { MerchantsService } from './merchants.service';

@ApiTags('merchant-compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('merchant')
export class MerchantComplianceController {
  constructor(private readonly merchants: MerchantsService) {}
  @Post('bank-accounts') addBankAccount(@Request() req: { user: { merchantId: string } }, @Body() body: { currency: string; accountNumber: string; routingNumber: string }) {
    return this.merchants.addBankAccount(req.user.merchantId, body);
  }
  @Patch('bank-accounts/:id/default') setDefault(@Request() req: { user: { merchantId: string } }, @Param('id') id: string) {
    return this.merchants.setDefaultBankAccount(req.user.merchantId, id);
  }
  @Post('kyc/documents') uploadKycDocument(@Request() req: { user: { merchantId: string } }, @Body() body: { name: string; mimeType: string; data: string }) {
    return this.merchants.addKycDocument(req.user.merchantId, body);
  }
}
