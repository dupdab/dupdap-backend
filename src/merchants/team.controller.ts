import { Scopes } from '../auth/decorators/scopes.decorator';
import { Body, Controller, Delete, SetMetadata, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ApiErrors } from '../common/api-errors.decorator';
import { MemberRole } from './entities/merchant-member.entity';
import { TeamService } from './team.service';

class RoleDto {
  @ApiProperty({ enum: MemberRole }) @IsEnum(MemberRole) role: MemberRole;
}
class InviteDto extends RoleDto {
  @ApiProperty() @IsEmail() email: string;
}
@ApiTags('merchant team')
@ApiBearerAuth('bearer')
@ApiErrors()
@UseGuards(JwtAuthGuard)
@Controller('merchant/team')
export class TeamController {
  constructor(private team: TeamService) {}
  private owner(req: any) {
    if (req.user.authType === 'apiKey' || (req.user.memberRole && req.user.memberRole !== MemberRole.OWNER))
      throw new ForbiddenException('Owner session required');
  }
  @Post()
  @ApiOperation({ summary: 'Invite a registered email to this merchant; use X-Merchant-ID to select the team on subsequent requests' })
  @ApiResponse({ status: 201, description: 'Membership created; invitee signs in with their own account' })
  invite(@Req() req: any, @Body() dto: InviteDto) {
    this.owner(req); return this.team.invite(req.user.merchantId, dto.email, dto.role);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'Update member role' })
  @ApiResponse({ status: 200 })
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    this.owner(req); return this.team.update(req.user.merchantId, id, dto.role);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Remove member and revoke their API key' })
  @ApiResponse({ status: 200 })
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    this.owner(req); return this.team.update(req.user.merchantId, id);
  }
  @Post('api-keys')
  @Scopes('profile:read')
  @SetMetadata('memberKeyCreation', true)
  @ApiOperation({ summary: 'Create a key bounded by the current member role; rotation revokes the old key' })
  @ApiResponse({ status: 201 })
  key(@Req() req: any) {
    if (req.user.authType === 'apiKey') throw new ForbiddenException('Use an interactive session');
    return this.team.key(req.user);
  }
}
