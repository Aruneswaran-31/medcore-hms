import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../cache/cache.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const ACCESS_COOKIE = 'medcore_rt';

export interface RefreshPayload {
  sub: string;
  deviceId: string;
  jti: string;
}

/**
 * Access tokens are stateless and short-lived. Refresh tokens are stored server
 * side under `rt:{userId}:{deviceId}` and rotated on every exchange, so a stolen
 * or replayed refresh token is detected and kills every session for that user.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async issueAccessToken(user: AuthUser, deviceId: string): Promise<{ token: string; expiresIn: number }> {
    const ttl = this.config.get<string>('jwt.accessTtl') ?? '15m';
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        hospitalId: user.hospitalId,
        firstName: user.firstName,
        lastName: user.lastName,
        deviceId,
      },
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: ttl as any },
    );
    return { token, expiresIn: 15 * 60 };
  }

  async issueRefreshToken(userId: string, deviceId: string): Promise<{ token: string; maxAge: number }> {
    const jti = randomUUID();
    const token = await this.jwt.signAsync(
      { sub: userId, deviceId, jti },
      { secret: this.config.get<string>('jwt.refreshSecret'), expiresIn: REFRESH_TTL_SECONDS },
    );
    await this.cache.set(this.key(userId, deviceId), { token, jti }, REFRESH_TTL_SECONDS);
    return { token, maxAge: REFRESH_TTL_SECONDS * 1000 };
  }

  /**
   * Rotating exchange. Returns the user id when the token is valid and fresh,
   * revokes everything on replay.
   */
  async rotate(rawToken: string): Promise<{ userId: string; deviceId: string }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(rawToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    const stored = await this.cache.get<{ token: string; jti: string }>(
      this.key(payload.sub, payload.deviceId),
    );

    if (!stored || stored.token !== rawToken) {
      // Replay of an already-rotated token → revoke all sessions for this user.
      await this.cache.delByPrefix(`rt:${payload.sub}:`);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Session revoked after a refresh token replay. Please sign in again.',
      });
    }

    await this.cache.del(this.key(payload.sub, payload.deviceId));
    return { userId: payload.sub, deviceId: payload.deviceId };
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    await this.cache.del(this.key(userId, deviceId));
  }

  async revokeAll(userId: string): Promise<number> {
    return this.cache.delByPrefix(`rt:${userId}:`);
  }

  async isSessionActive(userId: string, deviceId: string): Promise<boolean> {
    return (await this.cache.get(this.key(userId, deviceId))) !== null;
  }

  private key(userId: string, deviceId: string): string {
    return `rt:${userId}:${deviceId}`;
  }
}