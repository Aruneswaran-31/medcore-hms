import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Role } from '@medcore/types';
import type { AuthUser } from '../common/decorators/current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  hospitalId: string | null;
  firstName: string;
  lastName: string;
  deviceId: string;
}

/**
 * Access tokens are short-lived (15 min) and only carry identity claims.
 * Refresh tokens live in the cache store and are rotated on every use.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret') ?? 'dev_only_access_secret_change_me',
    });
  }

  validate(payload: AccessTokenPayload): AuthUser & { deviceId: string } {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      hospitalId: payload.hospitalId ?? null,
      firstName: payload.firstName,
      lastName: payload.lastName,
      deviceId: payload.deviceId,
    };
  }
}