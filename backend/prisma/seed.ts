/**
 * Demo seed (PRD §13): 2 hospitals, 8 doctors, 30 patients and two weeks of
 * appointment history so every dashboard renders real-looking data.
 *
 *   pnpm --filter backend db:seed
 *
 * All people, hospitals and records are invented.
 */
import { PrismaClient, Role, AppointmentStatus, Gender } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Deterministic pseudo-random so reseeding produces stable demo data.
let seed = 42;
function rand(max: number): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % max;
}
function pick<T>(items: T[]): T {
  return items[rand(items.length)];
}
/** Positive modulo — `day` can be negative when seeding history. */
function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}
function dayOffset(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const SPECIALITIES = [
  'Cardiology',
  'Orthopaedics',
  'General Medicine',
  'Paediatrics',
  'ENT',
  'Dermatology',
  'Neurology',
  'Obstetrics & Gynaecology',
];

const DEPARTMENTS = [
  { name: 'Cardiology', code: 'CARD', description: 'Heart and vascular care' },
  { name: 'Orthopaedics', code: 'ORTHO', description: 'Bone, joint and spine care' },
  { name: 'General Medicine', code: 'GEN', description: 'Outpatient internal medicine' },
  { name: 'Paediatrics', code: 'PAED', description: 'Child and adolescent care' },
  { name: 'ENT', code: 'ENT', description: 'Ear, nose and throat' },
  { name: 'Pathology & Lab', code: 'LAB', description: 'Diagnostics and laboratory' },
];

const FIRST_NAMES = [
  'Arun', 'Divya', 'Karthik', 'Meena', 'Rahul', 'Sneha', 'Vignesh', 'Priya', 'Aruna',
  'Suresh', 'Kavya', 'Manoj', 'Lakshmi', 'Ravi', 'Anitha', 'Sathish', 'Nithya', 'Prakash',
  'Deepa', 'Harish', 'Swetha', 'Gokul', 'Ramya', 'Saravanan', 'Janani', 'Mohan', 'Keerthi',
  'Ashok', 'Poorna', 'Vimal',
];
const LAST_NAMES = [
  'Kumar', 'Rao', 'Sharma', 'Iyer', 'Nair', 'Reddy', 'Pillai', 'Menon', 'Das', 'Verma',
  'Krishnan', 'Subramanian', 'Bhat', 'Chetty', 'Mudaliar',
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const ALLERGIES = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Latex', 'Iodine contrast', 'None known'];
const CONDITIONS = ['Type 2 Diabetes', 'Hypertension', 'Hypothyroidism', 'Asthma', 'None'];

export async function runSeed(): Promise<void> {
  console.log('Seeding MedCore HMS…');

  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.labOrderItem.deleteMany(),
    prisma.labOrder.deleteMany(),
    prisma.prescriptionItem.deleteMany(),
    prisma.prescription.deleteMany(),
    prisma.medicalRecord.deleteMany(),
    prisma.vaccination.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.medicineBatch.deleteMany(),
    prisma.medicine.deleteMany(),
    prisma.labTest.deleteMany(),
    prisma.doctorAvailability.deleteMany(),
    prisma.doctor.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.department.deleteMany(),
    prisma.user.deleteMany(),
    prisma.hospital.deleteMany(),
    prisma.address.deleteMany(),
  ]);

  const password = await bcrypt.hash('Passw0rd!123', 12);

  // ── Hospitals + addresses ────────────────────────────────────────────────
  const [apollo, fortis] = await Promise.all([
    prisma.hospital.create({
      data: {
        name: 'Apollo MedCore Chennai',
        slug: 'apollo-medcore-chennai',
        licenseNumber: 'TN-HOSP-0042',
        email: 'chennai@medcore.demo',
        phone: '+914440001000',
        isVerified: true,
        subscriptionPlan: 'ENTERPRISE',
        bedCount: 320,
        address: {
          create: {
            line1: '12, Guindy Hospital Road',
            city: 'Chennai',
            state: 'Tamil Nadu',
            postalCode: '600032',
            country: 'IN',
          },
        },
      },
    }),
    prisma.hospital.create({
      data: {
        name: 'MedCore Fortis Delhi',
        slug: 'medcore-fortis-delhi',
        licenseNumber: 'DL-HOSP-0117',
        email: 'delhi@medcore.demo',
        phone: '+911140001000',
        isVerified: true,
        subscriptionPlan: 'STANDARD',
        bedCount: 180,
        address: {
          create: {
            line1: '44, Saket Ring Road',
            city: 'New Delhi',
            state: 'Delhi',
            postalCode: '110017',
            country: 'IN',
          },
        },
      },
    }),
  ]);
  const hospitals = [apollo, fortis];
  console.log(`  • ${hospitals.length} hospitals`);

  // ── Platform super admin ────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      email: 'superadmin@medcore.demo',
      passwordHash: password,
      firstName: 'Platform',
      lastName: 'Operator',
      role: Role.SUPER_ADMIN,
      emailVerifiedAt: new Date(),
    },
  });

  // ── Departments ─────────────────────────────────────────────────────────
  const departmentsByHospital: Record<string, Record<string, string>> = {};
  for (const hospital of hospitals) {
    departmentsByHospital[hospital.id] = {};
    for (const dept of DEPARTMENTS) {
      const created = await prisma.department.create({
        data: { hospitalId: hospital.id, ...dept },
      });
      departmentsByHospital[hospital.id][dept.code] = created.id;
    }
  }
  console.log(`  • ${DEPARTMENTS.length * hospitals.length} departments`);

  // ── Hospital admins + operational staff ─────────────────────────────────
  for (const hospital of hospitals) {
    const slug = hospital.slug.split('-')[0];
    await prisma.user.create({
      data: {
        email: `admin.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Hospital',
        lastName: 'Administrator',
        role: Role.HOSPITAL_ADMIN,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        email: `reception.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Front',
        lastName: 'Desk',
        role: Role.RECEPTIONIST,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        email: `lab.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Lab',
        lastName: 'Technician',
        role: Role.LAB_TECHNICIAN,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        email: `pharmacy.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Chief',
        lastName: 'Pharmacist',
        role: Role.PHARMACIST,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        email: `accounts.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Accounts',
        lastName: 'Executive',
        role: Role.ACCOUNTANT,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        email: `nursing.${slug}@medcore.demo`,
        passwordHash: password,
        firstName: 'Ward',
        lastName: 'Nurse',
        role: Role.NURSE,
        hospitalId: hospital.id,
        emailVerifiedAt: new Date(),
      },
    });
  }
  console.log('  • 12 hospital staff accounts');

  // ── Doctors + weekly availability (Mon–Fri mornings, some afternoons) ────
  const doctors: Array<{ id: string; hospitalId: string; userId: string }> = [];
  let doctorIndex = 0;
  for (const hospital of hospitals) {
    for (let i = 0; i < 4; i++) {
      const specialisation = SPECIALITIES[doctorIndex % SPECIALITIES.length];
      const firstName = FIRST_NAMES[(doctorIndex * 3) % FIRST_NAMES.length];
      const lastName = LAST_NAMES[doctorIndex % LAST_NAMES.length];
      const deptCode =
        specialisation === 'Cardiology'
          ? 'CARD'
          : specialisation === 'Orthopaedics'
            ? 'ORTHO'
            : specialisation === 'Paediatrics'
              ? 'PAED'
              : specialisation === 'ENT'
                ? 'ENT'
                : 'GEN';

      const user = await prisma.user.create({
        data: {
          email: `dr.${firstName.toLowerCase()}.${lastName.toLowerCase()}@medcore.demo`,
          passwordHash: password,
          firstName,
          lastName,
          role: Role.DOCTOR,
          hospitalId: hospital.id,
          emailVerifiedAt: new Date(),
          phone: `+9198${String(40000000 + doctorIndex * 111111).slice(0, 8)}`,
          doctor: {
            create: {
              hospitalId: hospital.id,
              departmentId: departmentsByHospital[hospital.id][deptCode],
              specialization: specialisation,
              licenseNumber: `LIC-${hospital.slug.slice(0, 3).toUpperCase()}-${1000 + doctorIndex}`,
              consultationFee: 500 + rand(10) * 100,
              bio: `Consultant ${specialisation} with focus on outpatient care.`,
            },
          },
        },
        include: { doctor: true },
      });

      const doctor = user.doctor!;
      doctors.push({ id: doctor.id, hospitalId: hospital.id, userId: user.id });

      const schedule =
        doctorIndex % 3 === 0
          ? [
              { weekday: 1, startTime: '09:00', endTime: '13:00', slotMinutes: 30 },
              { weekday: 3, startTime: '09:00', endTime: '13:00', slotMinutes: 30 },
              { weekday: 5, startTime: '14:00', endTime: '18:00', slotMinutes: 30 },
            ]
          : [
              { weekday: 1, startTime: '10:00', endTime: '14:00', slotMinutes: 30 },
              { weekday: 2, startTime: '09:00', endTime: '13:00', slotMinutes: 30 },
              { weekday: 4, startTime: '09:00', endTime: '13:00', slotMinutes: 30 },
              { weekday: 6, startTime: '09:00', endTime: '12:00', slotMinutes: 30 },
            ];

      await prisma.doctorAvailability.createMany({
        data: schedule.map((slot) => ({
          doctorId: doctor.id,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotMinutes: slot.slotMinutes,
        })),
      });
      doctorIndex++;
    }
  }
  console.log(`  • ${doctors.length} doctors with weekly schedules`);

  // ── Patients (30 per the PRD seed brief, split across tenants) ──────────
  const receptionist = await prisma.user.findFirst({ where: { role: Role.RECEPTIONIST } });
  const patients: Array<{ id: string; hospitalId: string; userId: string }> = [];
  for (let i = 0; i < 30; i++) {
    const hospital = hospitals[i % hospitals.length];
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 2) % LAST_NAMES.length];
    const gender: Gender = i % 2 === 0 ? Gender.FEMALE : Gender.MALE;
    const dob = new Date(Date.now() - (18 + rand(50)) * 365 * 24 * 3600 * 1000);

    const user = await prisma.user.create({
      data: {
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i + 1}@medcore.demo`,
        passwordHash: password,
        firstName,
        lastName,
        role: Role.PATIENT,
        hospitalId: hospital.id,
        phone: `+9190${String(10000000 + i * 123456).slice(0, 8)}`,
        emailVerifiedAt: new Date(),
        patient: {
          create: {
            hospitalId: hospital.id,
            mrn: `MRN-${String(i + 1).padStart(6, '0')}`,
            dateOfBirth: dob,
            gender,
            bloodGroup: pick(BLOOD_GROUPS),
            allergies: [pick(ALLERGIES)],
            chronicConditions: [pick(CONDITIONS)],
            insuranceProvider: i % 3 === 0 ? 'Star Health' : null,
            insurancePolicyNumber: i % 3 === 0 ? `SH-${20250000 + i}` : null,
            emergencyContactName: `${pick(FIRST_NAMES)} ${lastName}`,
            emergencyContactPhone: '+919876543210',
            registeredById: receptionist?.id,
          },
        },
      },
      include: { patient: true },
    });
    patients.push({ id: user.patient!.id, hospitalId: hospital.id, userId: user.id });
  }
  console.log(`  • ${patients.length} patients`);

  // ── Lab test catalogue + pharmacy stock ─────────────────────────────────
  const LAB_TESTS = [
    { code: 'HB', name: 'Haemoglobin', category: 'Haematology', price: 120, unit: 'g/dL', min: 13, max: 17.5, text: '13.0–17.5 g/dL (male)' },
    { code: 'WBC', name: 'White Blood Cell Count', category: 'Haematology', price: 150, unit: '10³/µL', min: 4, max: 11, text: '4.0–11.0 ×10³/µL' },
    { code: 'PLT', name: 'Platelet Count', category: 'Haematology', price: 180, unit: '10³/µL', min: 150, max: 450, text: '150–450 ×10³/µL' },
    { code: 'FBS', name: 'Fasting Blood Sugar', category: 'Biochemistry', price: 90, unit: 'mg/dL', min: 70, max: 100, text: '70–100 mg/dL' },
    { code: 'CREAT', name: 'Serum Creatinine', category: 'Biochemistry', price: 200, unit: 'mg/dL', min: 0.7, max: 1.3, text: '0.7–1.3 mg/dL' },
    { code: 'TSH', name: 'Thyroid Stimulating Hormone', category: 'Endocrinology', price: 350, unit: 'mIU/L', min: 0.4, max: 4.2, text: '0.4–4.2 mIU/L' },
    { code: 'LIPID', name: 'Lipid Profile', category: 'Biochemistry', price: 450, unit: 'mg/dL', min: 0, max: 200, text: 'Total cholesterol < 200 mg/dL' },
    { code: 'URINE', name: 'Urine Routine', category: 'Pathology', price: 110, unit: null, min: null, max: null, text: 'No abnormal constituents' },
  ];
  for (const hospital of hospitals) {
    for (const test of LAB_TESTS) {
      await prisma.labTest.create({
        data: {
          hospitalId: hospital.id,
          code: test.code,
          name: test.name,
          category: test.category,
          price: test.price,
          unit: test.unit,
          referenceMin: test.min,
          referenceMax: test.max,
          referenceText: test.text,
        },
      });
    }
  }
  console.log(`  • ${LAB_TESTS.length * hospitals.length} lab tests`);

  const MEDICINES = [
    { name: 'Paracetamol 650', generic: 'Paracetamol', form: 'TABLET', strength: '650 mg', reorder: 500, mrp: 3.5, qty: 4000, expiryDays: 400 },
    { name: 'Amoxicillin 500', generic: 'Amoxicillin', form: 'CAPSULE', strength: '500 mg', reorder: 300, mrp: 8, qty: 250, expiryDays: 500 },
    { name: 'Metformin 500', generic: 'Metformin', form: 'TABLET', strength: '500 mg', reorder: 400, mrp: 4, qty: 3000, expiryDays: 700 },
    { name: 'Atorvastatin 10', generic: 'Atorvastatin', form: 'TABLET', strength: '10 mg', reorder: 250, mrp: 9, qty: 180, expiryDays: 600 },
    { name: 'Cetirizine 10', generic: 'Cetirizine', form: 'TABLET', strength: '10 mg', reorder: 200, mrp: 2.5, qty: 160, expiryDays: 22 },
    { name: 'Pantoprazole 40', generic: 'Pantoprazole', form: 'TABLET', strength: '40 mg', reorder: 300, mrp: 6, qty: 900, expiryDays: 550 },
    { name: 'ORS Sachet', generic: 'Oral Rehydration Salts', form: 'SYRUP', strength: '21.8 g', reorder: 150, mrp: 22, qty: 40, expiryDays: 15 },
    { name: 'Insulin Glargine', generic: 'Insulin Glargine', form: 'INJECTION', strength: '100 IU/mL', reorder: 50, mrp: 850, qty: 60, expiryDays: 260 },
  ];
  for (const hospital of hospitals) {
    for (const med of MEDICINES) {
      const medicine = await prisma.medicine.create({
        data: {
          hospitalId: hospital.id,
          name: med.name,
          genericName: med.generic,
          form: med.form as any,
          strength: med.strength,
          reorderLevel: med.reorder,
        },
      });
      await prisma.medicineBatch.create({
        data: {
          medicineId: medicine.id,
          hospitalId: hospital.id,
          batchNumber: `B${hospital.slug.slice(0, 2).toUpperCase()}${rand(9000) + 1000}`,
          manufacturedAt: dayOffset(-120),
          expiresAt: dayOffset(med.expiryDays),
          quantity: med.qty,
          unitCost: Number((med.mrp * 0.6).toFixed(2)),
          mrp: med.mrp,
        },
      });
    }
  }
  console.log(`  • ${MEDICINES.length * hospitals.length} medicines with batches`);

  // ── Appointments, encounters, prescriptions, lab orders, invoices ───────
  const usedSlots = new Set<string>();
  let invoiceSeq = 0;
  let appointmentCount = 0;
  let recordCount = 0;

  for (let day = -14; day <= 3; day++) {
    const date = dayOffset(day);
    const isPast = day < 0;
    const isToday = day === 0;

    for (let slot = 0; slot < 6; slot++) {
      const doctor = doctors[mod(day + slot, doctors.length)];
      const patient = patients[mod(day * 3 + slot, patients.length)];
      if (patient.hospitalId !== doctor.hospitalId) continue;

      const startTime = `${String(9 + slot).padStart(2, '0')}:00`;
      const endTime = `${String(9 + slot).padStart(2, '0')}:30`;
      const key = `${doctor.id}:${iso(date)}:${startTime}`;
      if (usedSlots.has(key)) continue;
      usedSlots.add(key);

      const status: AppointmentStatus = isPast
        ? pick(['COMPLETED', 'COMPLETED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as AppointmentStatus[])
        : isToday
          ? pick(['CONFIRMED', 'IN_PROGRESS', 'PENDING', 'COMPLETED'] as AppointmentStatus[])
          : pick(['PENDING', 'CONFIRMED', 'CONFIRMED'] as AppointmentStatus[]);

      const appointment = await prisma.appointment.create({
        data: {
          hospitalId: doctor.hospitalId,
          patientId: patient.id,
          doctorId: doctor.id,
          scheduledDate: date,
          startTime,
          endTime,
          status,
          type: slot === 4 && day % 5 === 0 ? 'EMERGENCY' : 'CONSULTATION',
          reason: pick(['Fever for 3 days', 'Follow-up consultation', 'Chest pain', 'Routine check-up', 'Skin rash', 'Migraine']),
        },
      });
      appointmentCount++;

      if (status !== 'COMPLETED') continue;

      const labTests = await prisma.labTest.findMany({ where: { hospitalId: doctor.hospitalId } });
      const test = pick(labTests);
      const value = test.referenceMin !== null && test.referenceMax !== null
        ? Number((test.referenceMin + (test.referenceMax - test.referenceMin) * (rand(100) / 100)).toFixed(1))
        : null;
      const outOfRange = slot % 4 === 3 && value !== null;
      const resultValue = outOfRange && test.referenceMax !== null
        ? Number((test.referenceMax + 2).toFixed(1))
        : value;

      const record = await prisma.medicalRecord.create({
        data: {
          hospitalId: doctor.hospitalId,
          appointmentId: appointment.id,
          patientId: patient.id,
          doctorId: doctor.id,
          chiefComplaint: appointment.reason ?? 'General consultation',
          presentingSymptoms: 'Mild symptoms, stable vitals, no distress.',
          vitals: {
            bpSystolic: 110 + rand(30),
            bpDiastolic: 70 + rand(15),
            pulse: 68 + rand(25),
            temperature: Number((36.4 + rand(20) / 10).toFixed(1)),
            spo2: 95 + rand(5),
            heightCm: 155 + rand(30),
            weightKg: 52 + rand(30),
            bmi: Number((22 + rand(6)).toFixed(1)),
          },
          diagnosis: pick(['Viral fever', 'Essential hypertension', 'Type 2 diabetes mellitus', 'Acute pharyngitis', 'Allergic dermatitis']),
          icd10Code: pick(['A09', 'I10', 'E11.9', 'J02.9', 'L23.9']),
          treatmentPlan: 'Hydration, adequate rest, review after 5 days if symptoms persist.',
          allergies: patient.hospitalId ? [] : [],
          status: 'FINALIZED',
          finalizedAt: new Date(),
        },
      });
      recordCount++;

      const medicines = await prisma.medicine.findMany({ where: { hospitalId: doctor.hospitalId } });
      const medicine = pick(medicines);
      const rx = await prisma.prescription.create({
        data: {
          hospitalId: doctor.hospitalId,
          medicalRecordId: record.id,
          patientId: patient.id,
          doctorId: doctor.id,
          status: day < -7 ? 'DISPENSED' : 'ISSUED',
          notes: 'Take after food. Complete the full course.',
          items: {
            create: [
              {
                medicineId: medicine.id,
                medicineName: medicine.name,
                form: medicine.form,
                dosage: medicine.strength ?? '500 mg',
                frequency: 'BD',
                durationDays: 5,
                quantity: 10,
                dispensedQty: day < -7 ? 10 : 0,
                instructions: 'After meals',
              },
            ],
          },
        },
      });
      if (day < -7) {
        await prisma.prescription.update({ where: { id: rx.id }, data: { dispensedAt: new Date() } });
      }

      const orderedBy = await prisma.doctor.findUnique({ where: { id: doctor.id } });
      const labOrder = await prisma.labOrder.create({
        data: {
          hospitalId: doctor.hospitalId,
          medicalRecordId: record.id,
          patientId: patient.id,
          orderedById: orderedBy!.id,
          status: day < -2 ? 'APPROVED' : 'ORDERED',
          priority: slot % 5 === 0 ? 'URGENT' : 'ROUTINE',
          approvedAt: day < -2 ? new Date() : null,
          items: {
            create: [
              {
                labTestId: test.id,
                resultValue: day < -2 ? resultValue : null,
                flag: day < -2 && outOfRange ? 'HIGH' : day < -2 ? 'NORMAL' : null,
                performedAt: day < -2 ? new Date() : null,
              },
            ],
          },
        },
      });
      void labOrder;

      const labTotal = Number(test.price);
      const consultFee = 600;
      const medPrice = Number(((MEDICINES.find((m) => m.name === medicine.name)?.mrp ?? 10) * 10).toFixed(2));
      invoiceSeq++;
      const invoice = await prisma.invoice.create({
        data: {
          hospitalId: doctor.hospitalId,
          patientId: patient.id,
          appointmentId: appointment.id,
          invoiceNumber: `INV-${new Date().getFullYear()}-${String(invoiceSeq).padStart(6, '0')}`,
          status: day < -1 ? 'PAID' : 'ISSUED',
          subtotal: consultFee + labTotal + medPrice,
          discount: 0,
          tax: 0,
          total: consultFee + labTotal + medPrice,
          amountPaid: day < -1 ? consultFee + labTotal + medPrice : 0,
          paidAt: day < -1 ? new Date() : null,
          items: {
            create: [
              { itemType: 'CONSULTATION', description: 'Consultation fee', quantity: 1, unitPrice: consultFee, total: consultFee },
              { itemType: 'LAB', description: test.name, quantity: 1, unitPrice: labTotal, total: labTotal, labOrderId: labOrder.id },
              { itemType: 'PHARMACY', description: `${medicine.name} x10`, quantity: 1, unitPrice: medPrice, total: medPrice, prescriptionId: rx.id },
            ],
          },
        },
        include: { items: true },
      });

      if (day < -1) {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            hospitalId: doctor.hospitalId,
            patientId: patient.id,
            amount: invoice.total,
            method: slot % 2 === 0 ? 'CARD' : 'CASH',
            provider: slot % 2 === 0 ? 'STRIPE' : 'CASH',
            status: 'SUCCEEDED',
            paidAt: new Date(),
          },
        });
      }
    }
  }
  console.log(
    `  • ${appointmentCount} appointments, ${recordCount} encounters, ${invoiceSeq} invoices`,
  );

  // ── A few in-app notifications so the bell isn't empty ───────────────────
  const patientUsers = await prisma.user.findMany({
    where: { role: Role.PATIENT },
    take: 5,
    select: { id: true, hospitalId: true },
  });
  for (const patientUser of patientUsers) {
    await prisma.notification.create({
      data: {
        userId: patientUser.id,
        hospitalId: patientUser.hospitalId,
        type: 'APPOINTMENT_CONFIRMED',
        title: 'Appointment confirmed',
        body: 'Your appointment has been confirmed. Please arrive 15 minutes early.',
        link: '/portal/appointments',
      },
    });
  }

  console.log('Seed complete.');
  console.log('Demo credentials — password for every account: Passw0rd!123');
  console.log('  superadmin@medcore.demo   (platform)');
  console.log('  admin.apollo@medcore.demo (hospital admin)');
  console.log('  dr.<name>@medcore.demo    (doctors, see README)');
  console.log('  reception.apollo@medcore.demo / pharmacy.apollo@medcore.demo / lab.apollo@medcore.demo');
}

if (require.main === module) {
  runSeed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
