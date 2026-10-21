import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PaymentsService } from './payments.service';
import { HoldPaymentDto } from './dto/hold-payment.dto';
import { Auditable } from '../audit/decorators/auditable.decorator';

@ApiTags('admin/payments')
@ApiBearerAuth('bearer')
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PaymentsAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':id/hold')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: 'PAYMENT_HELD', resource: 'payment' })
  @ApiOperation({ summary: 'Place a confirmed payment on hold for fraud review (blocks refund and settlement)' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Payment placed on hold' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiBadRequestResponse({ description: 'Payment not in a holdable state or reason missing' })
  hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldPaymentDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.paymentsService.hold(id, dto.reason, req.user?.id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: 'PAYMENT_RELEASED', resource: 'payment' })
  @ApiOperation({ summary: 'Release a payment hold and restore its prior status so it can continue to settlement' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'Hold released' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  @ApiBadRequestResponse({ description: 'Payment is not on hold' })
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.paymentsService.release(id, req.user?.id);
  }
}
