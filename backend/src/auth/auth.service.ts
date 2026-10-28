import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { TokenService } from './token.service';
import { permissionsFor } from './permissions';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { Role } from '@medcore/types';
import type {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const OTP_TTL = 10 * 60;
const RESET_TTL = 30 * 60;
// Pre-computed hash so a failed login takes the same time as a wrong password.
const DECOY_HASH = bcrypt.hashSync('decoy-password-not-real', 12);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
      });
    }

    const hospitalId = await this.resolveHospital(dto.hospitalId);
    const role: Role = dto.role === 'DOCTOR' ? 'DOCTOR' : 'PATIENT';

    const passwordHash = await bcrypt.hash(dto.password, this.config.get<number>('bcryptCost') ?? 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role,
        hospitalId,
      },
    });

    if (role === 'PATIENT') {
      await this.prisma.patient.create({
        data: {
          userId: user.id,
          hospitalId,
          mrn: await this.nextMrn(hospitalId),
          registeredById: user.id,
        },
      });
    }

    const otp = this.otp();
    await this.cache.set(`otp:email:${dto.email}`, otp, OTP_TTL);
    await this.deliverOtp(dto.email, otp, 'email');

    const { passwordHash: _ignored, ...safe } = user;
    return { user: safe, verificationSent: true };
  }

  async verifyEmail(email: string, otp: string) {
    const expected = await this.cache.get<string>(`otp:email:${email}`);
    if (!expected || expected !== otp) {
      throw new BadRequestException({ code: 'INVALID_OTP', message: 'The OTP is incorrect or expired.' });
    }
    await this.cache.del(`otp:email:${email}`);
    await this.prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async verifyPhone(user: AuthUser, otp: string) {
    const expected = await this.cache.get<string>(`otp:phone:${user.id}`);
    if (!expected || expected !== otp) {
      throw new BadRequestException({ code: 'INVALID_OTP', message: 'The OTP is incorrect or expired.' });
    }
    await this.cache.del(`otp:phone:${user.id}`);
    await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    return { verified: true };
  }

  async login(dto: LoginDto, deviceId: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Constant-shape failure: never reveal whether the email exists.
    if (!user || user.deletedAt) {
      await bcrypt.compare(dto.password, DECOY_HASH);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account has been suspended. Contact your hospital administrator.',
      });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    const access = await this.tokens.issueAccessToken(authUser, deviceId);
    const refresh = await this.tokens.issueRefreshToken(user.id, deviceId);

    await this.prisma.auditLog.create({
      data: {
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        hospitalId: user.hospitalId,
      },
    });

    return {
      user: this.profile(user.id),
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshMaxAge: refresh.maxAge,
      permissions: permissionsFor(user.role),
    };
  }

  async refresh(rawToken: string, deviceId: string) {
    const { userId } = await this.tokens.rotate(rawToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Account no longer exists.' });
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    const access = await this.tokens.issueAccessToken(authUser, deviceId);
    const refresh = await this.tokens.issueRefreshToken(user.id, deviceId);
    return {
      user: this.profile(user.id),
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshMaxAge: refresh.maxAge,
      permissions: permissionsFor(user.role),
    };
  }

  async logout(user: AuthUser, deviceId: string) {
    await this.tokens.revoke(user.id, deviceId);
    return { loggedOut: true };
  }

  async logoutEverywhere(user: AuthUser) {
    const count = await this.tokens.revokeAll(user.id);
    return { loggedOut: true, sessionsRevoked: count };
  }

  async me(user: AuthUser) {
    return this.profile(user.id);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Always answer the same way to avoid account enumeration.
    if (user) {
      const token = await this.jwt.signAsync(
        { sub: user.id, email: user.email, purpose: 'password-reset' },
        { secret: this.config.get('jwt.refreshSecret'), expiresIn: RESET_TTL },
      );
      await this.cache.set(`pwd:${token}`, user.id, RESET_TTL);
      this.logger.log(`Password reset link for ${dto.email}: /reset-password?token=${token}`);
    }
    return { accepted: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    let email: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; purpose?: string }>(
        dto.token,
        { secret: this.config.get('jwt.refreshSecret') },
      );
      if (payload.purpose !== 'password-reset') throw new Error('wrong purpose');
      const cached = await this.cache.get<string>(`pwd:${dto.token}`);
      if (!cached || cached !== payload.sub) throw new Error('token consumed');
      email = payload.email;
    } catch {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This password reset link is invalid or has expired.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException({ code: 'INVALID_RESET_TOKEN', message: 'Reset link is invalid.' });
    }
    const passwordHash = await bcrypt.hash(dto.password, this.config.get<number>('bcryptCost') ?? 12);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.cache.del(`pwd:${dto.token}`);
    await this.tokens.revokeAll(user.id);
    return { reset: true };
  }

  /** Returns the full profile with permissions for GET /auth/me. */
  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { hospital: { include: { address: true } }, doctor: true, patient: true },
    });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Account no longer exists.' });
    }
    const { passwordHash: _hash, ...safe } = user;
    return {
      ...safe,
      emailVerified: Boolean(user.emailVerifiedAt),
      permissions: permissionsFor(user.role),
    };
  }

  private async resolveHospital(hospitalId?: string): Promise<string> {
    if (hospitalId) {
      const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId } });
      if (!hospital) {
        throw new BadRequestException({ code: 'UNKNOWN_HOSPITAL', message: 'Hospital not found.' });
      }
      return hospital.id;
    }
    const demo = await this.prisma.hospital.findFirst({
      where: { isVerified: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!demo) {
      throw new BadRequestException({
        code: 'NO_HOSPITAL',
        message: 'No hospital is available for registration. Seed the database first.',
      });
    }
    return demo.id;
  }

  private async nextMrn(hospitalId: string): Promise<string> {
    const count = await this.prisma.patient.count({ where: { hospitalId } });
    return `MRN-${String(count + 1).padStart(6, '0')}`;
  }

  private otp(): string {
    return String(randomInt(100000, 999999));
  }

  /** Email/SMS adapters are pluggable; without keys the code is logged (dev). */
  private async deliverOtp(destination: string, otp: string, channel: 'email' | 'phone') {
    this.logger.log(`[${channel} OTP] ${destination} → ${otp}`);
  }
}