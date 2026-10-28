import { AppointmentsService } from './appointments/appointments.service';
import { HospitalsService } from './hospitals/hospitals.service';
import type { AuthUser } from './common/decorators/current-user.decorator';

const doctorUser: AuthUser = {
  id: 'user-doctor',
  email: 'doctor@apollo.test',
  role: 'DOCTOR',
  hospitalId: 'hospital-a',
  firstName: 'Deepa',
  lastName: 'Rao',
};

const foreignUser: AuthUser = {
  id: 'user-foreign',
  email: 'admin@fortis.test',
  role: 'HOSPITAL_ADMIN',
  hospitalId: 'hospital-b',
  firstName: 'Vikram',
  lastName: 'Shah',
};

const patientUser: AuthUser = {
  id: 'user-patient',
  email: 'patient@apollo.test',
  role: 'PATIENT',
  hospitalId: 'hospital-a',
  firstName: 'Arun',
  lastName: 'Kumar',
};

const auditStub = { record: jest.fn().mockResolvedValue(undefined) };

/** Awaits a rejection and asserts the stable machine-readable error code. */
async function expectRejection(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err: any) {
    const body = typeof err?.getResponse === 'function' ? err.getResponse() : err;
    expect(body).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected rejection with code ${code}, but the call succeeded.`);
}

function makeService(overrides: Record<string, unknown>): AppointmentsService {
  const prisma = {
    appointment: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    doctor: { findUnique: jest.fn() },
    doctorAvailability: { findFirst: jest.fn() },
    patient: { findFirst: jest.fn(), findUnique: jest.fn() },
    ...overrides,
  } as any;
  return new AppointmentsService(prisma, auditStub as any);
}

const baseBooking = {
  doctorId: 'doc-1',
  scheduledDate: '2025-04-18',
  startTime: '09:30',
  patientId: 'pat-1',
};

const sameTenantDoctor = {
  id: 'doc-1',
  hospitalId: 'hospital-a',
  deletedAt: null,
  departmentId: null,
  user: {},
};

const sameTenantPatient = {
  id: 'pat-1',
  hospitalId: 'hospital-a',
  deletedAt: null,
};

const schedule = {
  weekday: 5,
  startTime: '09:00',
  endTime: '13:00',
  slotMinutes: 30,
  isOffline: false,
};

describe('tenancy isolation (PRD §11)', () => {
  it('blocks a hospital admin from reading another tenant', async () => {
    const service = new HospitalsService({ hospital: { findUnique: jest.fn() } } as any, auditStub as any);
    await expectRejection(service.findOne('hospital-a', foreignUser), 'TENANT_MISMATCH');
  });

  it('allows an admin to read their own tenant', async () => {
    const hospital = { id: 'hospital-a', name: 'Apollo', deletedAt: null };
    const service = new HospitalsService(
      { hospital: { findUnique: jest.fn().mockResolvedValue(hospital) } } as any,
      auditStub as any,
    );
    await expect(service.findOne('hospital-a', doctorUser)).resolves.toEqual(hospital);
  });

  it('refuses to book a patient that belongs to a different hospital', async () => {
    const service = makeService({
      doctor: { findUnique: jest.fn().mockResolvedValue(sameTenantDoctor) },
      doctorAvailability: { findFirst: jest.fn().mockResolvedValue(schedule) },
      patient: { findUnique: jest.fn().mockResolvedValue({ ...sameTenantPatient, hospitalId: 'hospital-b' }) },
    });
    await expectRejection(service.book(baseBooking, doctorUser), 'TENANT_MISMATCH');
  });

  it('rejects a patient booking for somebody else', async () => {
    const service = makeService({
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pat-own', hospitalId: 'hospital-a' }),
        findUnique: jest.fn(),
      },
    });
    await expectRejection(
      service.book({ ...baseBooking, patientId: 'pat-someone-else' }, patientUser),
      'FORBIDDEN',
    );
  });
});

describe('appointment concurrency (PRD §07.2)', () => {
  it('fails with SLOT_UNAVAILABLE when another patient already holds the slot', async () => {
    const service = makeService({
      doctor: { findUnique: jest.fn().mockResolvedValue(sameTenantDoctor) },
      doctorAvailability: { findFirst: jest.fn().mockResolvedValue(schedule) },
      patient: { findUnique: jest.fn().mockResolvedValue(sameTenantPatient) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { doctorId: 'doc-1', patientId: 'pat-other', startTime: '09:30', endTime: '10:00' },
        ]),
        create: jest.fn(),
      },
    });

    await expectRejection(service.book(baseBooking, doctorUser), 'SLOT_UNAVAILABLE');
  });

  it('prevents the same patient from sitting in two consultations at once', async () => {
    const service = makeService({
      doctor: { findUnique: jest.fn().mockResolvedValue(sameTenantDoctor) },
      doctorAvailability: { findFirst: jest.fn().mockResolvedValue(schedule) },
      patient: { findUnique: jest.fn().mockResolvedValue(sameTenantPatient) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { doctorId: 'doc-2', patientId: 'pat-1', startTime: '09:00', endTime: '10:00' },
        ]),
        create: jest.fn(),
      },
    });

    await expectRejection(service.book(baseBooking, doctorUser), 'PATIENT_DOUBLE_BOOKED');
  });

  it('translates a database unique-violation into SLOT_UNAVAILABLE', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const service = makeService({
      doctor: { findUnique: jest.fn().mockResolvedValue(sameTenantDoctor) },
      doctorAvailability: { findFirst: jest.fn().mockResolvedValue(schedule) },
      patient: { findUnique: jest.fn().mockResolvedValue(sameTenantPatient) },
      appointment: { findMany: jest.fn().mockResolvedValue([]), create },
    });

    await expectRejection(service.book(baseBooking, doctorUser), 'SLOT_UNAVAILABLE');
    expect(create).toHaveBeenCalled();
  });

  it('allows an emergency booking outside the weekly schedule', async () => {
    const created = { id: 'appt-1', status: 'CONFIRMED', isEmergency: true };
    const create = jest.fn().mockResolvedValue(created);
    const service = makeService({
      doctor: { findUnique: jest.fn().mockResolvedValue(sameTenantDoctor) },
      doctorAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
      patient: { findUnique: jest.fn().mockResolvedValue(sameTenantPatient) },
      appointment: { findMany: jest.fn().mockResolvedValue([]), create },
    });

    const result = await service.book(
      { ...baseBooking, type: 'EMERGENCY', startTime: '22:00' },
      doctorUser,
    );
    expect(result).toEqual(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isEmergency: true, status: 'CONFIRMED' }),
      }),
    );
  });
});
