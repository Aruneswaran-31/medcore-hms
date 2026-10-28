import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/auth.decorator';
import type { Role } from '@medcore/types';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * RBAC guard — a route declares its allowed roles with @Roles(...).
 * Tenancy is enforced separately: every query filters on `user.hospitalId`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Authentication required.' });
    }

    // Platform operators may cross tenants; everyone else must match the allow-list.
    if (user.role === 'SUPER_ADMIN' || required.includes(user.role)) return true;

    throw new ForbiddenException({
      code: 'INSUFFICIENT_ROLE',
      message: `Role ${user.role} is not permitted to perform this action.`,
    });
  }
}