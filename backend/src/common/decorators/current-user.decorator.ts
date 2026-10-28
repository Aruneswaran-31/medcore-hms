import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@medcore/types';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  hospitalId: string | null;
  firstName: string;
  lastName: string;
}

/**
 * Extracts the authenticated principal. Tenant scoping always derives hospitalId
 * from here — never from a client-supplied query/body field.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    return data ? user?.[data] : user;
  },
);