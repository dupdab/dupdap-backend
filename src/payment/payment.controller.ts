import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { MerchantGuard } from '../auth/guards/merchant.guard';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentDetailsDto } from './dto/payment-details.dto';
import { PaymentListDto } from './dto/payment-list.dto';
import { PaymentStatusDto } from './dto/payment-status.dto';
import { PaymentFiltersDto } from './dto/payment-filters.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { PaymentReceiptDto } from './dto/payment-receipt.dto';
import { CommonResponseDto } from '../common/dto/common-response.dto';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(ThrottlerGuard, MerchantGuard)
@UseInterceptors(ClassSerializerInterceptor)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a new payment request' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Payment request created successfully',
    type: PaymentDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiBody({ type: CreatePaymentDto })
  async createPayment(
    @Request() req: { user: { merchantId: string } },
    @Body() createPaymentDto: CreatePaymentDto,
    @Headers('idempotency-key') _idempotencyKey?: string,
  ): Promise<CommonResponseDto<PaymentDetailsDto>> {
    const payment = await this.paymentService.createPayment(
      req.user.merchantId,
      createPaymentDto,
    );
    return {
      success: true,
      data: payment,
      message: 'Payment request created successfully',
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get list of payments with filtering and pagination',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payments retrieved successfully',
    type: PaymentListDto,
  })
  @ApiQuery({ type: PaymentFiltersDto })
  async getPayments(
    @Request() req: { user: { merchantId: string } },
    @Query() filters: PaymentFiltersDto,
  ): Promise<CommonResponseDto<PaymentListDto>> {
    const result = await this.paymentService.getPayments(
      req.user.merchantId,
      filters,
    );
    return {
      success: true,
      data: result,
      message: 'Payments retrieved successfully',
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment details by ID' })
  @ApiParam({ name: 'id', description: 'Payment ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment details retrieved successfully',
    type: PaymentDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  async getPaymentById(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommonResponseDto<PaymentDetailsDto>> {
    const payment = await this.paymentService.getPaymentById(
      id,
      req.user.merchantId,
    );
    return {
      success: true,
      data: payment,
      message: 'Payment details retrieved successfully',
    };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get real-time payment status' })
  @ApiParam({ name: 'id', description: 'Payment ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment status retrieved successfully',
    type: PaymentStatusDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  async getPaymentStatus(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommonResponseDto<PaymentStatusDto>> {
    const status = await this.paymentService.getPaymentStatus(
      id,
      req.user.merchantId,
    );
    return {
      success: true,
      data: status,
      message: 'Payment status retrieved successfully',
    };
  }

  @Get(':id/qr-code')
  @ApiOperation({ summary: 'Generate QR code for payment' })
  @ApiParam({ name: 'id', description: 'Payment ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'QR code generated successfully',
    schema: {
      type: 'object',
      properties: {
        qrCodeData: {
          type: 'string',
          description: 'Base64 encoded QR code image',
        },
        paymentUrl: { type: 'string', description: 'Payment URL for QR code' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  async getPaymentQrCode(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommonResponseDto<{ qrCodeData: string; paymentUrl: string }>> {
    const qrCode = await this.paymentService.generateQrCode(
      id,
      req.user.merchantId,
    );
    return {
      success: true,
      data: qrCode,
      message: 'QR code generated successfully',
    };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending payment' })
  @ApiParam({ name: 'id', description: 'Payment ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment cancelled successfully',
    type: PaymentDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Payment cannot be cancelled',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  @ApiBody({ type: CancelPaymentDto })
  async cancelPayment(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() cancelDto: CancelPaymentDto,
  ): Promise<CommonResponseDto<PaymentDetailsDto>> {
    const payment = await this.paymentService.cancelPayment(
      id,
      req.user.merchantId,
      cancelDto.reason,
    );
    return {
      success: true,
      data: payment,
      message: 'Payment cancelled successfully',
    };
  }

  @Get('reference/:reference')
  @ApiOperation({ summary: 'Get payment by reference' })
  @ApiParam({
    name: 'reference',
    description: 'Payment reference',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment retrieved successfully',
    type: PaymentDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  async getPaymentByReference(
    @Request() req: { user: { merchantId: string } },
    @Param('reference') reference: string,
  ): Promise<CommonResponseDto<PaymentDetailsDto>> {
    const payment = await this.paymentService.getPaymentByReference(
      reference,
      req.user.merchantId,
    );
    return {
      success: true,
      data: payment,
      message: 'Payment retrieved successfully',
    };
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Generate payment receipt' })
  @ApiParam({ name: 'id', description: 'Payment ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Receipt generated successfully',
    type: PaymentReceiptDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Receipt not available for this payment',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Payment not found',
  })
  async getPaymentReceipt(
    @Request() req: { user: { merchantId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommonResponseDto<PaymentReceiptDto>> {
    const receipt = await this.paymentService.generateReceipt(
      id,
      req.user.merchantId,
    );
    return {
      success: true,
      data: receipt,
      message: 'Receipt generated successfully',
    };
  }
}
