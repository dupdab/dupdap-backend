import { Controller, Post, Delete, Body, Param, UseGuards, Request, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { RecurringPaymentsService } from './recurring-payments.service';
import { CreateRecurringPaymentDto } from './dto/create-recurring-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Scopes } from '../auth/decorators/scopes.decorator';

@ApiTags('recurring-payments')
@ApiBearerAuth('bearer')
@ApiSecurity('api-key')
@UseGuards(JwtAuthGuard)
@Controller('merchant/recurring-payments')
export class RecurringPaymentsController {
  constructor(private readonly recurringPaymentsService: RecurringPaymentsService) {}

  @Post()
  @Scopes('payments:write')
  @ApiOperation({ summary: 'Create a recurring payment (subscription)' })
  @ApiOkResponse({ description: 'Recurring payment created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  create(@Request() req: { user: { merchantId: string } }, @Body() dto: CreateRecurringPaymentDto) {
    return this.recurringPaymentsService.create(req.user.merchantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes('payments:write')
  @ApiOperation({ summary: 'Cancel a recurring payment' })
  @ApiNoContentResponse({ description: 'Recurring payment cancelled' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT / API key' })
  @ApiForbiddenResponse({ description: 'API key missing payments:write scope' })
  @ApiNotFoundResponse({ description: 'Recurring payment not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  cancel(@Request() req: { user: { merchantId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurringPaymentsService.cancel(id, req.user.merchantId);
  }
}
