import { Test, TestingModule } from '@nestjs/testing';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

/**
 * Regression coverage for #202: JwtStrategy populates `req.user.merchantId`
 * (never `req.user.id`), so every mutating Groups handler must forward
 * `merchantId` to the service. Before the fix these all forwarded `undefined`.
 */
describe('GroupsController', () => {
  let controller: GroupsController;
  const service = {
    createGroup: jest.fn().mockResolvedValue({ id: 'g-1' }),
    searchGroups: jest.fn().mockResolvedValue([]),
    getGroup: jest.fn().mockResolvedValue({ id: 'g-1' }),
    updateGroup: jest.fn().mockResolvedValue({ id: 'g-1' }),
    deleteGroup: jest.fn().mockResolvedValue(undefined),
    generateInviteCode: jest.fn().mockResolvedValue({ inviteCode: 'abc' }),
    joinByInviteCode: jest.fn().mockResolvedValue({ id: 'g-1' }),
    setTokenGate: jest.fn().mockResolvedValue({ id: 'g-1' }),
    removeTokenGate: jest.fn().mockResolvedValue({ id: 'g-1' }),
  };

  // Shape produced by JwtStrategy.validate() / the API-key branch of JwtAuthGuard.
  const req = { user: { merchantId: 'merchant-123', email: 'a@b.com', role: 'admin' } } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [{ provide: GroupsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GroupsController>(GroupsController);
  });

  it('forwards merchantId to createGroup', async () => {
    await controller.create({ name: 'Test' } as any, req);
    expect(service.createGroup).toHaveBeenCalledWith({ name: 'Test' }, 'merchant-123');
  });

  it('forwards merchantId to updateGroup', async () => {
    await controller.update('g-1', { name: 'x' } as any, req);
    expect(service.updateGroup).toHaveBeenCalledWith('g-1', { name: 'x' }, 'merchant-123');
  });

  it('forwards merchantId to remove', async () => {
    await controller.remove('g-1', req);
    expect(service.deleteGroup).toHaveBeenCalledWith('g-1', 'merchant-123');
  });

  it('forwards merchantId to regenerateInviteCode', async () => {
    await controller.regenerateInviteCode('g-1', req);
    expect(service.generateInviteCode).toHaveBeenCalledWith('g-1', 'merchant-123');
  });

  it('forwards merchantId to join', async () => {
    await controller.join('invite-1', req);
    expect(service.joinByInviteCode).toHaveBeenCalledWith('invite-1', 'merchant-123');
  });

  it('forwards merchantId to setGate', async () => {
    await controller.setGate('g-1', { contractAddress: '0x0' } as any, req);
    expect(service.setTokenGate).toHaveBeenCalledWith('g-1', { contractAddress: '0x0' }, 'merchant-123');
  });

  it('forwards merchantId to removeGate', async () => {
    await controller.removeGate('g-1', req);
    expect(service.removeTokenGate).toHaveBeenCalledWith('g-1', 'merchant-123');
  });

  it('never forwards undefined (the pre-fix req.user.id bug)', async () => {
    await controller.create({ name: 'Test' } as any, req);
    expect(service.createGroup).not.toHaveBeenCalledWith(expect.anything(), undefined);
  });
});
