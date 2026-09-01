import { Controller, Post, Body, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { JwtAuthGuard } from './guards/jwt.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invalidate the current JWT before its natural expiry' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  async logout(@Req() req: Request): Promise<{ success: boolean }> {
    const payload = req.user as { jti?: string; sub?: string; exp?: number };
    const jti = payload.jti ?? payload.sub;
    const exp = payload.exp;

    if (jti) {
      const ttlSeconds = exp ? Math.max(Math.floor(exp - Date.now() / 1000), 0) : 3600;
      await this.authService.logout(jti, ttlSeconds);
    }

    return { success: true };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new merchant' })
  @ApiResponse({ status: 201, description: 'Registered', type: AuthTokenResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  register(@Body() dto: RegisterDto): Promise<AuthTokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merchant login' })
  @ApiResponse({ status: 200, description: 'Authenticated', type: AuthTokenResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.authService.login(dto);
  }
}
