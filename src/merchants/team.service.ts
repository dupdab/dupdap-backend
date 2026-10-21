import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { MerchantMember, MemberRole } from './entities/merchant-member.entity';
import { Merchant } from './entities/merchant.entity';
import { API_KEY_SCOPES, ApiScope } from '../auth/scopes';

export const memberScopes = (role: MemberRole): ApiScope[] => role === MemberRole.OWNER
  ? API_KEY_SCOPES : role === MemberRole.DEVELOPER
    ? API_KEY_SCOPES.filter(scope => !['profile:write', 'groups:manage'].includes(scope))
    : API_KEY_SCOPES.filter(scope => scope.endsWith(':read'));

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(MerchantMember) private members: Repository<MerchantMember>,
    @InjectRepository(Merchant) private merchants: Repository<Merchant>,
  ) {}
  async context(user: any, merchantId: string) {
    if (user.authType === 'apiKey') throw new ForbiddenException('Use an interactive session');
    const target = await this.merchants.findOneBy({ id: merchantId });
    if (!target || target.status === 'suspended') throw new ForbiddenException('Account unavailable');
    if (user.merchantId === merchantId) return { ...user, memberRole: MemberRole.OWNER };
    const member = await this.members.findOneBy({ merchantId, email: user.email.toLowerCase() });
    if (!member) throw new ForbiddenException('Team membership required');
    return { ...user, merchantId, memberId: member.id, memberRole: member.role };
  }
  async invite(merchantId: string, email: string, role: MemberRole) {
    email = email.toLowerCase();
    const owner = await this.merchants.findOneBy({ id: merchantId });
    if (owner?.email.toLowerCase() === email) throw new ConflictException('Account owner already belongs to team');
    try { return await this.members.save(this.members.create({ merchantId, email, role })); }
    catch (error) { if (error.code === '23505') throw new ConflictException('Member already invited'); throw error; }
  }
  async update(merchantId: string, id: string, role?: MemberRole) {
    const member = await this.members.findOneBy({ id, merchantId });
    if (!member) throw new NotFoundException('Member not found');
    if (role) { member.role = role; return this.members.save(member); }
    await this.members.remove(member);
  }
  async key(user: any) {
    if (!user.memberId) throw new ForbiddenException('Select a team membership');
    const key = randomBytes(32).toString('hex');
    await this.members.update(user.memberId, { apiKeyHash: createHash('sha256').update(key).digest('hex') });
    return { apiKey: key, scopes: memberScopes(user.memberRole) };
  }
  async authenticate(key: string) {
    const member = await this.members.createQueryBuilder('member').addSelect('member.apiKeyHash')
      .where('member.apiKeyHash = :hash', { hash: createHash('sha256').update(key).digest('hex') }).getOne();
    if (!member) return null;
    const merchant = await this.merchants.findOneBy({ id: member.merchantId });
    if (!merchant || merchant.status === 'suspended') throw new UnauthorizedException('Account unavailable');
    return { merchantId: member.merchantId, memberId: member.id, email: member.email, role: 'merchant',
      memberRole: member.role, authType: 'apiKey', scopes: memberScopes(member.role) };
  }
}
