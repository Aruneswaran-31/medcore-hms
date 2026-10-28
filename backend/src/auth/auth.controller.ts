import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ACCESS_COOKIE } from './token.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyPhoneDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account and send an email OTP' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue access + refresh tokens' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const deviceId = this.deviceId(req);
    const result = await this.auth.login(dto, deviceId);
    this.setRefreshCookie(res, result.refreshToken, result.refreshMaxAge);
    return {
      user: await result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      permissions: result.permissions,
    };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!raw) {
      return { error: { code: 'NO_REFRESH_TOKEN', message: 'No session cookie present.' } };
    }
    const deviceId = this.deviceId(req);
    const result = await this.auth.refresh(raw, deviceId);
    this.setRefreshCookie(res, result.refreshToken, result.refreshMaxAge);
    return {
      user: await result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      permissions: result.permissions,
    };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke this device session' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logout(user, this.deviceId(req));
    res.clearCookie(ACCESS_COOKIE, { path: '/api/auth' });
    return result;
  }

  @Post('logout-all')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const result = this.auth.logoutEverywhere(user);
    res.clearCookie(ACCESS_COOKIE, { path: '/api/auth' });
    return result;
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Current profile with role permissions' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.email, dto.otp);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('verify-phone')
  @HttpCode(200)
  verifyPhone(@CurrentUser() user: AuthUser, @Body() dto: VerifyPhoneDto) {
    return this.auth.verifyPhone(user, dto.otp);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  /** Stable per-browser id so one device can be revoked without the others. */
  private deviceId(req: Request): string {
    const header = req.headers['x-device-id'];
    if (typeof header === 'string' && header.length > 0 && header.length <= 64) return header;
    const cookie = (req.cookies as Record<string, string> | undefined)?.['medcore_device'];
    return cookie ?? 'default-device';
  }

  private setRefreshCookie(res: Response, token: string, maxAge: number) {
    res.cookie(ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth',
      maxAge,
    });
  }
}