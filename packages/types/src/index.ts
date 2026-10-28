/**
 * Shared API contracts — imported by both the NestJS API and the Next.js client.
 * Keeping one source of truth eliminates an entire class of integration bugs.
 */

// ── Roles (RBAC) ────────────────────────────────────────────────────────────
export const ROLES = [
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
  'PATIENT',
] as const;

export type Role = (typeof ROLES)[number];

// ── Enumerations ────────────────────────────────────────────────────────────
export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';
export type AppointmentType = 'CONSULTATION' | 'FOLLOW_UP' | 'EMERGENCY';
export type LabOrderStatus =
  | 'ORDERED'
  | 'SAMPLE_COLLECTED'
  | 'IN_PROCESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';
export type ResultFlag = 'NORMAL' | 'LOW' | 'HIGH' | 'ABNORMAL';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type PaymentMethod = 'CARD' | 'UPI' | 'NETBANKING' | 'CASH' | 'INSURANCE';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type MedicineForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'INJECTION'
  | 'TOPICAL'
  | 'DROPS'
  | 'INHALER';
export type Frequency = 'OD' | 'BD' | 'TDS' | 'QID' | 'HS' | 'SOS';
export type PrescriptionStatus = 'ISSUED' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED';
export type NotificationType =
  | 'APPOINTMENT_CONFIRMED'
  | 'APPOINTMENT_REMINDER'
  | 'LAB_REPORT_READY'
  | 'PRESCRIPTION_READY'
  | 'INVOICE_GENERATED'
  | 'PAYMENT_RECEIVED'
  | 'LOW_STOCK'
  | 'EXPIRY_ALERT'
  | 'EMERGENCY'
  | 'GENERAL';
export type InvoiceItemType = 'CONSULTATION' | 'LAB' | 'PHARMACY' | 'ROOM' | 'OTHER';

// ── API envelope (section 08 of the PRD) ────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type ApiResponse<T> = ApiSuccess<T>;
export type ApiPaginated<T> = ApiSuccess<T[]> & { meta: PaginationMeta };

export interface PaginationQuery {
  page?: number;
  limit?: number;
  q?: string;
  hospitalId?: string;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: Role;
  hospitalId?: string;
  inviteCode?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  hospitalId: string | null;
  emailVerified: boolean;
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface MeResponse extends SessionUser {
  hospital?: HospitalDto | null;
}

// ── Entities ────────────────────────────────────────────────────────────────
export interface AddressDto {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface HospitalDto {
  id: string;
  name: string;
  slug: string;
  licenseNumber: string;
  email: string;
  phone: string;
  isVerified: boolean;
  subscriptionPlan: string;
  address?: AddressDto | null;
  createdAt: string;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: Role;
  status: UserStatus;
  hospitalId: string | null;
  emailVerifiedAt?: string | null;
  createdAt: string;
}

export interface DepartmentDto {
  id: string;
  hospitalId: string;
  name: string;
  code: string;
  description?: string | null;
}

export interface DoctorDto {
  id: string;
  userId: string;
  user?: UserDto;
  hospitalId: string;
  departmentId?: string | null;
  specialization: string;
  licenseNumber: string;
  consultationFee: number;
  bio?: string | null;
}

export interface PatientDto {
  id: string;
  userId: string;
  user?: UserDto;
  hospitalId: string;
  mrn: string;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  bloodGroup?: string | null;
  allergies?: string[];
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  createdAt: string;
}

export interface DoctorAvailabilityDto {
  id: string;
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isOffline: boolean;
}

export interface AppointmentDto {
  id: string;
  hospitalId: string;
  patientId: string;
  doctorId: string;
  departmentId?: string | null;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  type: AppointmentType;
  reason?: string | null;
  isEmergency: boolean;
  patient?: PatientDto;
  doctor?: DoctorDto;
  medicalRecordId?: string | null;
  invoiceId?: string | null;
  createdAt: string;
}

export interface Vitals {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  temperature?: number;
  spo2?: number;
  heightCm?: number;
  weightKg?: number;
  bmi?: number;
  respiratoryRate?: number;
  notes?: string;
}

export interface MedicalRecordDto {
  id: string;
  hospitalId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  chiefComplaint?: string | null;
  vitals?: Vitals | null;
  diagnosis?: string | null;
  icd10Code?: string | null;
  differentialDiagnosis?: string | null;
  treatmentPlan?: string | null;
  allergies?: string[];
  familyHistory?: string[];
  notes?: string | null;
  status: 'DRAFT' | 'FINALIZED';
  createdAt: string;
  updatedAt: string;
}

export interface PrescriptionItemDto {
  id: string;
  medicineId?: string | null;
  medicineName: string;
  form: MedicineForm;
  dosage: string;
  frequency: Frequency;
  durationDays: number;
  instructions?: string | null;
}

export interface PrescriptionDto {
  id: string;
  hospitalId: string;
  medicalRecordId: string;
  patientId: string;
  doctorId: string;
  status: PrescriptionStatus;
  notes?: string | null;
  items: PrescriptionItemDto[];
  issuedAt: string;
}

export interface LabTestDto {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  unit?: string | null;
  referenceMin?: number | null;
  referenceMax?: number | null;
  referenceText?: string | null;
}

export interface LabOrderItemDto {
  id: string;
  labTestId: string;
  labTest?: LabTestDto;
  resultValue?: number | null;
  resultText?: string | null;
  flag?: ResultFlag | null;
  resultFileUrl?: string | null;
}

export interface LabOrderDto {
  id: string;
  hospitalId: string;
  medicalRecordId?: string | null;
  patientId: string;
  orderedById: string;
  status: LabOrderStatus;
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  notes?: string | null;
  items: LabOrderItemDto[];
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
}

export interface MedicineDto {
  id: string;
  hospitalId: string;
  name: string;
  genericName?: string | null;
  form: MedicineForm;
  strength?: string | null;
  reorderLevel: number;
  availableQuantity: number;
  isActive: boolean;
}

export interface MedicineBatchDto {
  id: string;
  medicineId: string;
  batchNumber: string;
  expiresAt: string;
  quantity: number;
  unitCost: number;
  mrp: number;
}

export interface InvoiceItemDto {
  id: string;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceDto {
  id: string;
  hospitalId: string;
  patientId: string;
  appointmentId?: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  dueDate?: string | null;
  paidAt?: string | null;
  items: InvoiceItemDto[];
  createdAt: string;
}

export interface PaymentDto {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  provider: 'STRIPE' | 'RAZORPAY' | 'CASH' | 'INSURANCE';
  status: PaymentStatus;
  providerReference?: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  createdAt: string;
}

// ── Analytics ───────────────────────────────────────────────────────────────
export interface RevenuePoint {
  date: string;
  revenue: number;
  invoices: number;
}

export interface DashboardStats {
  patientsToday: number;
  appointmentsToday: number;
  revenueToday: number;
  activeDoctors: number;
  occupiedBeds: number;
  lowStockCount: number;
}

export interface SlotDto {
  startTime: string;
  endTime: string;
  available: boolean;
}