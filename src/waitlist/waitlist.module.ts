import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitlistService } from './waitlist.service';
import { WaitlistController } from './waitlist.controller';
import { WaitlistEntry } from './entities/waitlist.entity';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { Merchant } from '../merchants/entities/merchant.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [TypeOrmModule.forFeature([WaitlistEntry, Merchant]), EmailModule],
  controllers: [WaitlistController, AdminWaitlistController],
  providers: [WaitlistService],
})
export class WaitlistModule {}
