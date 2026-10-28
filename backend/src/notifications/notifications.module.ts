import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { NotificationType } from '@medcore/types';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

export interface CreateNotification {
  userId: string;
  hospitalId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

/**
 * Real-time notifications (PRD §07.8).
 * One in-process fan-out point: the row is persisted first, then pushed over
 * Socket.IO. Email/SMS handlers subscribe to the same events (see README).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(gateway: NotificationsGateway | null, payload: CreateNotification) {
    const notification = await this.prisma.notification.create({ data: payload });
    if (gateway) gateway.pushToUser(payload.userId, notification);
    return notification;
  }

  async list(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = {
      userId: user.id,
      ...(query.unread === 'true' ? { readAt: null } : {}),
    };
    const [total, unread, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), unread },
      message: 'OK',
    };
  }

  async markRead(id: string, user: AuthUser) {
    return this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: AuthUser) {
    return this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization ?? '').replace(/^Bearer /, '');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev_only_access_secret_change_me',
      });
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.emit('error', { code: 'UNAUTHENTICATED', message: 'Invalid socket credentials.' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('notifications:ack')
  handleAck(@MessageBody() id: string, @ConnectedSocket() client: Socket) {
    return { event: 'notifications:ack', data: { id, userId: client.data?.userId } };
  }

  pushToUser(userId: string, payload: unknown) {
    if (this.server) this.server.to(`user:${userId}`).emit('notification', payload);
  }
}

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user notifications' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.notifications.list(user, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification read' })
  markAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(id, user);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
