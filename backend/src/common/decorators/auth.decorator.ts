import { SetMetadata } from '@nestjs/common';
import type { Role } from '@medcore/types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks a route as reachable without a valid access token (login, refresh, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares which roles may hit a route. Guarded by RolesGuard.
 * SUPER_ADMIN is platform-wide and is implicitly allowed everywhere.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);