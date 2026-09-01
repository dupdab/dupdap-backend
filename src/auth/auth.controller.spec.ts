import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    const dto = {
      email: 'merchant@example.com',
      password: 'SecurePass123!',
      businessName: 'Acme Corp',
    };

    it('passes the DTO through to AuthService.register and returns its result', async () => {
      const expected = { accessToken: 'jwt-token', merchant: { id: 'm1', email: dto.email } };
      mockAuthService.register.mockResolvedValueOnce(expected);

      const result = await controller.register(dto as any);

      expect(service.register).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });

    it('propagates ConflictException from the service on duplicate email', async () => {
      mockAuthService.register.mockRejectedValueOnce(new ConflictException('Email already registered'));

      await expect(controller.register(dto as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const dto = { email: 'merchant@example.com', password: 'SecurePass123!' };

    it('passes the DTO through to AuthService.login and returns its result', async () => {
      const expected = { accessToken: 'jwt-token', merchant: { id: 'm1', email: dto.email } };
      mockAuthService.login.mockResolvedValueOnce(expected);

      const result = await controller.login(dto as any);

      expect(service.login).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });

    it('propagates UnauthorizedException from the service on invalid credentials', async () => {
      mockAuthService.login.mockRejectedValueOnce(new UnauthorizedException('Invalid credentials'));

      await expect(controller.login(dto as any)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('extracts jti/exp from the validated request and calls AuthService.logout', async () => {
      const exp = Math.floor(Date.now() / 1000) + 300;
      const req = { user: { merchantId: 'm1', jti: 'session-1', exp } } as any;

      const result = await controller.logout(req);

      expect(service.logout).toHaveBeenCalledWith('session-1', expect.any(Number));
      expect(result).toEqual({ success: true });
    });

    it('falls back to sub when jti is absent', async () => {
      const req = { user: { sub: 'merchant-1' } } as any;

      await controller.logout(req);

      expect(service.logout).toHaveBeenCalledWith('merchant-1', expect.any(Number));
    });
  });
});
