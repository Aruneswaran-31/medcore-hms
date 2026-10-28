import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

export interface AuditEntry {
  user?: AuthUser | null;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Every create/update/delete is recorded (PRD §10 — Audit Logging).
 * Auditing never breaks the main transaction: failures are logged, not thrown.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          hospitalId: entry.user?.hospitalId ?? null,
          userId: entry.user?.id ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: (entry.before as Prisma.InputJsonValue) ?? undefined,
          after: (entry.after as Prisma.InputJsonValue) ?? undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${entry.entityType}: ${(err as Error).message}`);
    }
  }

  /** Tenant-scoped feed; SUPER_ADMIN sees the whole platform. */
  listRecent(user: AuthUser, take: number) {
    return this.prisma.auditLog.findMany({
      where: user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }
}