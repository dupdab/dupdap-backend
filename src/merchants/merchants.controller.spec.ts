import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { NotificationPrefsService } from '../notifications/notification-prefs.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

describe('MerchantsController', () => {
  let controller: MerchantsController;
  let merchantsService: jest.Mocked<Pick<MerchantsService, 'getProfile' | 'update' | 'generateApiKey'>>;
  let notificationPrefsService: jest.Mocked<Pick<NotificationPrefsService, 'getPrefs' | 'updatePrefs'>>;

  beforeEach(async () => {
    merchantsService = {
      getProfile: jest.fn(),
      update: jest.fn(),
      generateApiKey: jest.fn(),
    } as any;

    notificationPrefsService = {
      getPrefs: jest.fn(),
      updatePrefs: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [
        { provide: MerchantsService, useValue: merchantsService },
        { provide: NotificationPrefsService, useValue: notificationPrefsService },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MerchantsController);
  });

  it('getProfile delegates to merchantsService with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    merchantsService.getProfile.mockResolvedValue({ id: 'merchant-1' });

    await expect(controller.getProfile(req)).resolves.toEqual({ id: 'merchant-1' });
    expect(merchantsService.getProfile).toHaveBeenCalledWith('merchant-1');
  });

  it('update requires the merchant:manage scope and delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    const dto = { businessName: 'DUPDAB' } as any;
    merchantsService.update.mockResolvedValue({ id: 'merchant-1', businessName: 'DUPDAB' } as any);

    await expect(controller.update(req, dto)).resolves.toEqual({ id: 'merchant-1', businessName: 'DUPDAB' });
    expect(merchantsService.update).toHaveBeenCalledWith('merchant-1', dto);
    expect(Reflect.getMetadata('scopes', MerchantsController.prototype.update)).toContain('merchant:manage');
  });

  it('generateApiKey delegates to merchantsService with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    const dto = { scopes: ['payments:read'] } as any;
    merchantsService.generateApiKey.mockResolvedValue({ apiKey: 'cpk_test' });

    await expect(controller.generateApiKey(req, dto)).resolves.toEqual({ apiKey: 'cpk_test' });
    expect(merchantsService.generateApiKey).toHaveBeenCalledWith('merchant-1', ['payments:read']);
  });

  it('getNotificationPrefs delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    notificationPrefsService.getPrefs.mockResolvedValue({ channels: {} } as any);

    await expect(controller.getNotificationPrefs(req)).resolves.toEqual({ channels: {} });
    expect(notificationPrefsService.getPrefs).toHaveBeenCalledWith('merchant-1');
  });

  it('updateNotificationPrefs delegates with the authenticated merchant id', async () => {
    const req = { user: { merchantId: 'merchant-1' } } as any;
    const dto = { email: { enabled: true } } as any;
    notificationPrefsService.updatePrefs.mockResolvedValue({ channels: {} } as any);

    await expect(controller.updateNotificationPrefs(req, dto)).resolves.toEqual({ channels: {} });
    expect(notificationPrefsService.updatePrefs).toHaveBeenCalledWith('merchant-1', dto);
  });

  it('requires the JWT guard on the controller', () => {
    expect(Reflect.getMetadata('__guards__', MerchantsController)).toContain(JwtAuthGuard);
  });
});
