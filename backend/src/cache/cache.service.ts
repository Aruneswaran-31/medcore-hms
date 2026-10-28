import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

/**
 * Session / cache abstraction.
 *
 * Uses Redis 7 when REDIS_URL is reachable (refresh tokens, availability cache,
 * rate-limit counters) and transparently falls back to an in-memory store so the
 * API and the test suite still run without Docker. Production always has Redis.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private readonly memory = new Map<string, MemoryEntry>();
  mode: 'redis' | 'memory' = 'memory';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('redisUrl');
    if (!url) {
      this.logger.warn('REDIS_URL not set — using the in-memory cache adapter (dev only).');
      return;
    }
    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      });
      this.redis.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
      await this.redis.connect();
      this.mode = 'redis';
      this.logger.log('Connected to Redis.');
    } catch (err) {
      this.redis = null;
      this.mode = 'memory';
      this.logger.warn(
        `Redis unavailable (${(err as Error).message}) — falling back to in-memory cache.`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw: string | null = this.redis
      ? await this.redis.get(key)
      : (this.readMemory(key) as string | null);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis) {
      if (ttlSeconds) await this.redis.set(key, raw, 'EX', ttlSeconds);
      else await this.redis.set(key, raw);
      return;
    }
    this.memory.set(key, {
      value: raw,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    if (this.redis) await this.redis.del(key);
    else this.memory.delete(key);
  }

  /** Used by "log out of all devices": drops every session key for a user. */
  async delByPrefix(prefix: string): Promise<number> {
    if (this.redis) {
      const keys = await this.redis.keys(`${prefix}*`);
      if (keys.length) return await this.redis.del(...keys);
      return 0;
    }
    let count = 0;
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) {
        this.memory.delete(key);
        count++;
      }
    }
    return count;
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (this.redis) {
      const value = await this.redis.incr(key);
      if (value === 1) await this.redis.expire(key, ttlSeconds);
      return value;
    }
    const current = this.readMemory<number>(key);
    const next = (typeof current === 'number' ? current : 0) + 1;
    await this.set(key, next, ttlSeconds);
    return next;
  }

  private readMemory<T>(key: string): T | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as unknown as T;
    }
  }
}