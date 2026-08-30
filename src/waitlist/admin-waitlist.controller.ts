import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { WaitlistNotifyDto, WaitlistQueryDto } from './dto/admin-waitlist.dto';
import { WaitlistService } from './waitlist.service';

@Controller('admin/waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
export class AdminWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  list(@Query() query: WaitlistQueryDto) { return this.waitlistService.list(query); }

  @Post(':id/approve')
  approve(@Param('id') id: string) { return this.waitlistService.approve(id); }

  @Post('notify/preview')
  preview(@Body() dto: WaitlistNotifyDto) { return this.waitlistService.notify(dto, true); }

  @Post('notify')
  notify(@Body() dto: WaitlistNotifyDto) { return this.waitlistService.notify(dto); }
}
