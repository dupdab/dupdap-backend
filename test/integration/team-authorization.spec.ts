import { TeamController } from '../../src/merchants/team.controller';
import { MemberRole } from '../../src/merchants/entities/merchant-member.entity';
import { memberScopes } from '../../src/merchants/team.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt.guard';
import { Reflector } from '@nestjs/core';

describe('Team authorization', () => {
  it.each([MemberRole.DEVELOPER, MemberRole.VIEWER])('prevents %s from managing members', role => {
    const controller = new TeamController({} as any);
    const req = { user: { merchantId: 'merchant', memberRole: role } };
    expect(() => controller.invite(req, { email: 'user@example.com', role: MemberRole.OWNER })).toThrow('Owner session required');
    expect(() => controller.update(req, 'id', { role: MemberRole.OWNER })).toThrow('Owner session required');
    expect(() => controller.remove(req, 'id')).toThrow('Owner session required');
  });
  it('prevents API keys from managing members or minting keys', () => {
    const controller = new TeamController({} as any);
    const req = { user: { merchantId: 'merchant', memberRole: MemberRole.OWNER, authType: 'apiKey' } };
    expect(() => controller.remove(req, 'id')).toThrow('Owner session required');
    expect(() => controller.key(req)).toThrow('interactive session');
  });
  it('viewer scopes are read only and account management cannot be delegated through keys', () => {
    expect(memberScopes(MemberRole.VIEWER).every(scope => scope.endsWith(':read'))).toBe(true);
    for (const role of Object.values(MemberRole)) expect(memberScopes(role)).not.toContain('merchant:manage');
  });
  it('denies writes on unscoped routes for restricted team API keys', async () => {
    const team = { authenticate: async () => ({ merchantId: 'm', memberRole: MemberRole.VIEWER, authType: 'apiKey', scopes: memberScopes(MemberRole.VIEWER) }) };
    const guard = new JwtAuthGuard({} as any, {} as any, new Reflector(), team as any);
    const req = { method: 'POST', headers: { 'x-api-key': 'test' } };
    const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
      getHandler: () => function handler() {}, getClass: () => class Controller {} };
    await expect(guard.canActivate(context as any)).rejects.toThrow('Insufficient member permissions');
  });
});
