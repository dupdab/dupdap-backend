import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationTemplateService } from './notification-template.service';
import {
  CreateNotificationTemplateDto,
  PreviewNotificationTemplateDto,
  RollbackNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/notification-template.dto';
import { NotificationTemplate, NotificationTemplateVersion } from './entities/notification-template.entity';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin/notification-templates')
@ApiBearerAuth()
@UseGuards(IpAllowlistGuard, JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN)
@Controller({ path: 'admin/notification-templates', version: '1' })
export class NotificationTemplateAdminController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @Get()
  @ApiOperation({ summary: 'List email notification templates (admin only)' })
  list(): Promise<NotificationTemplate[]> {
    return this.templates.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create an email notification template (admin only)' })
  create(@Body() dto: CreateNotificationTemplateDto): Promise<NotificationTemplate> {
    return this.templates.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an email notification template (admin only)' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<NotificationTemplate> {
    return this.templates.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an email notification template; records a new version (admin only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ): Promise<NotificationTemplate> {
    return this.templates.update(id, dto);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List version history of an email notification template (admin only)' })
  listVersions(@Param('id', ParseUUIDPipe) id: string): Promise<NotificationTemplateVersion[]> {
    return this.templates.listVersions(id);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: 'Restore an earlier version of an email notification template (admin only)' })
  rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RollbackNotificationTemplateDto,
  ): Promise<NotificationTemplate> {
    return this.templates.rollback(id, dto.version);
  }

  @Post(':id/preview')
  @ApiOperation({ summary: 'Render an email notification template with test data (admin only)' })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewNotificationTemplateDto,
  ): Promise<{ subject: string; html: string }> {
    return this.templates.preview(id, dto.testData);
  }
}
