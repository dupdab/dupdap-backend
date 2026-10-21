import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeoipService } from './geoip.service';

@Module({
  imports: [ConfigModule],
  providers: [GeoipService],
  exports: [GeoipService],
})
export class GeoipModule {}
