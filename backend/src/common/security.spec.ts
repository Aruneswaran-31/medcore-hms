import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from '../invoices/invoice.controller';
import { RolesGuard } from './guards/roles.guard';
import { permissionsFor, ROLE_PERMISSIONS } from '../auth/permissions';
import type { Role } from '@medcore/types';

describe('payment webhook security (PRD §07.7)', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount_received: 125000, metadata: { invoiceId: 'inv-1' } } },
  });

  const sign = (body: string, stamp: number, key = secret) =>
    createHmac('sha256', key)
      .update(`${stamp}.${body}`)
      .digest('hex');

  it('accepts a payload with a valid signature', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${sign(payload, t)}`;
    expect(verifyStripeSignature(payload, header, secret)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${sign(payload, t)}`;
    const tampered = payload.replace('125000', '999999999');
    expect(verifyStripeSignature(tampered, header, secret)).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${sign(payload, t, 'whsec_wrong')}`;
    expect(verifyStripeSignature(payload, header, secret)).toBe(false);
  });

  it('rejects replayed webhooks older than five minutes', () => {
    const stale = Math.floor(Date.now() / 1000) - 600;
    const header = `t=${stale},v1=${sign(payload, stale)}`;
    expect(verifyStripeSignature(payload, header, secret)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyStripeSignature(payload, undefined, secret)).toBe(false);
    expect(verifyStripeSignature(payload, 'v1=abc', secret)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1,v1=${'a'.repeat(64)}`, '')).toBe(false);
  });
});

describe('role-based access control (PRD §06)', () => {
  const guard = new RolesGuard({
    getAllAndOverride: (_key: string, [handler]: unknown[]) => (handler as any).__roles,
  } as any);

  const contextWith = (roles: string[] | undefined, user?: unknown) =>
    ({
      getHandler: () => ({ __roles: roles }),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('allows access when the route declares no roles', () => {
    expect(guard.canActivate(contextWith(undefined, { role: 'PATIENT' }))).toBe(true);
  });

  it('allows a matching role', () => {
    expect(guard.canActivate(contextWith(['DOCTOR'], { role: 'DOCTOR' }))).toBe(true);
  });

  it('allows SUPER_ADMIN everywhere', () => {
    expect(guard.canActivate(contextWith(['PHARMACIST'], { role: 'SUPER_ADMIN' }))).toBe(true);
  });

  it('denies a non-matching role with a stable error code', () => {
    let thrown: any;
    try {
      guard.canActivate(contextWith(['DOCTOR'], { role: 'PATIENT' }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.getResponse()).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('denies unauthenticated callers when roles are required', () => {
    let thrown: any;
    try {
      guard.canActivate(contextWith(['DOCTOR'], undefined));
    } catch (err) {
      thrown = err;
    }
    expect(thrown.getResponse()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('covers all nine roles in the permission matrix', () => {
    const roles: Role[] = [
      'SUPER_ADMIN',
      'HOSPITAL_ADMIN',
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'LAB_TECHNICIAN',
      'PHARMACIST',
      'ACCOUNTANT',
      'PATIENT',
    ];
    for (const role of roles) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(9);
  });

  it('keeps patients scoped to their own data only', () => {
    const permissions = permissionsFor('PATIENT');
    expect(permissions).toContain('record:read:own');
    expect(permissions).not.toContain('record:write');
    expect(permissions).not.toContain('invoice:write');
  });
});
