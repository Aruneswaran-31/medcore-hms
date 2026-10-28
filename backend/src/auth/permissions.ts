import type { Role } from '@medcore/types';

/**
 * Permission matrix (PRD §06). Endpoint-level access is enforced by @Roles();
 * this map is returned by GET /auth/me so the UI can hide what a user cannot do.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  SUPER_ADMIN: ['*'],
  HOSPITAL_ADMIN: [
    'hospital:read',
    'hospital:update',
    'department:manage',
    'user:manage',
    'doctor:manage',
    'analytics:read',
    'invoice:read',
    'invoice:write',
    'audit:read',
    'medicine:manage',
  ],
  DOCTOR: [
    'appointment:read',
    'appointment:update',
    'patient:read',
    'record:write',
    'prescription:write',
    'lab:order',
    'analytics:read:own',
  ],
  NURSE: ['appointment:read', 'patient:read', 'record:write:vitals', 'record:read'],
  RECEPTIONIST: [
    'patient:register',
    'patient:read',
    'appointment:read',
    'appointment:book',
    'appointment:update',
    'invoice:write',
  ],
  LAB_TECHNICIAN: ['lab:read:assigned', 'lab:result:write', 'lab:approve'],
  PHARMACIST: ['medicine:read', 'medicine:manage', 'prescription:dispense', 'invoice:write'],
  ACCOUNTANT: ['invoice:read', 'invoice:write', 'payment:manage', 'analytics:read'],
  PATIENT: [
    'appointment:book',
    'appointment:read:own',
    'record:read:own',
    'prescription:read:own',
    'invoice:read:own',
    'payment:pay',
    'notification:read:own',
  ],
};

export function permissionsFor(role: Role): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}