import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import type { CreateInvoiceDto, PaymentDto } from './invoice.dto';

export function computeTotals(
  items: Array<{ quantity?: number; unitPrice: number; taxRate?: number }>,
  discount = 0,
) {
  const subtotal = items.reduce((sum, item) => sum + (item.quantity ?? 1) * item.unitPrice, 0);
  const tax = Number(
    items
      .reduce(
        (sum, item) => sum + (item.quantity ?? 1) * item.unitPrice * ((item.taxRate ?? 0) / 100),
        0,
      )
      .toFixed(2),
  );
  const total = Number((subtotal - discount + tax).toFixed(2));
  return { subtotal: Number(subtotal.toFixed(2)), tax, total: Math.max(0, total) };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateInvoiceDto, user: AuthUser) {
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId } });
    if (!patient) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' });
    if (user.role !== 'SUPER_ADMIN' && patient.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant invoice denied.' });
    }
    if (!dto.items?.length) {
      throw new BadRequestException({ code: 'NO_ITEMS', message: 'An invoice needs at least one line item.' });
    }

    // Totals are always derived server-side (PRD §11 — billing integrity).
    const totals = computeTotals(dto.items, dto.discount ?? 0);
    const seq = (await this.prisma.invoice.count()) + 1;
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const invoice = await this.prisma.invoice.create({
      data: {
        hospitalId: patient.hospitalId,
        patientId: patient.id,
        appointmentId: dto.appointmentId,
        invoiceNumber,
        status: 'DRAFT',
        subtotal: totals.subtotal,
        discount: dto.discount ?? 0,
        tax: totals.tax,
        total: totals.total,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: user.id,
        items: {
          create: dto.items.map((item) => ({
            itemType: item.itemType,
            description: item.description,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 0,
            total: Number(((item.quantity ?? 1) * item.unitPrice).toFixed(2)),
            labOrderId: item.labOrderId,
            prescriptionId: item.prescriptionId,
          })),
        },
      },
      include: { items: true, patient: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });

    await this.audit.record({
      user,
      action: 'CREATE',
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { total: totals.total },
    });
    return invoice;
  }

  async list(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = {
      deletedAt: null,
      ...(user.role === 'SUPER_ADMIN' ? {} : { hospitalId: user.hospitalId ?? '' }),
      ...(await this.patientScope(user, query.patientId)),
      ...(query.status ? { status: query.status as any } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          items: true,
          patient: { include: { user: { select: { firstName: true, lastName: true } } } },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, message: 'OK' };
  }

  async findOne(id: string, user: AuthUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        patient: { include: { user: true } },
        appointment: true,
      },
    });
    if (!invoice) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
    if (user.role !== 'SUPER_ADMIN' && invoice.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ code: 'TENANT_MISMATCH', message: 'Cross-tenant access denied.' });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      if (!own || own.id !== invoice.patientId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This invoice is not yours.' });
      }
    }
    return invoice;
  }

  async issue(id: string, user: AuthUser) {
    const invoice = await this.findOne(id, user);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException({ code: 'ALREADY_ISSUED', message: 'Only draft invoices can be issued.' });
    }
    return this.prisma.invoice.update({
      where: { id },
      data: { status: 'ISSUED' },
      include: { items: true },
    });
  }

  /**
   * Records a confirmed payment and re-derives invoice status.
   * Card/UPI flows must arrive through the verified webhook below, never here.
   */
  async recordPayment(id: string, dto: PaymentDto, user: AuthUser) {
    const invoice = await this.findOne(id, user);
    if (invoice.status === 'VOID') {
      throw new BadRequestException({ code: 'INVOICE_VOID', message: 'A void invoice cannot be paid.' });
    }
    if (dto.amount <= 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be positive.' });
    }
    const remaining = Number(invoice.total) - Number(invoice.amountPaid);
    if (dto.amount > remaining + 0.001) {
      throw new BadRequestException({
        code: 'OVERPAYMENT',
        message: `Amount exceeds the outstanding balance of ${remaining.toFixed(2)}.`,
      });
    }

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        hospitalId: invoice.hospitalId,
        patientId: invoice.patientId,
        amount: dto.amount,
        method: dto.method ?? 'CASH',
        provider: dto.provider ?? 'CASH',
        providerReference: dto.providerReference,
        status: 'SUCCEEDED',
        paidAt: new Date(),
      },
    });

    const paid = Number(invoice.amountPaid) + dto.amount;
    const settled = paid >= Number(invoice.total) - 0.001;
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { amountPaid: paid, status: settled ? 'PAID' : 'PARTIALLY_PAID', paidAt: settled ? new Date() : null },
      include: { items: true, payments: true },
    });

    await this.audit.record({
      user,
      action: 'PAYMENT',
      entityType: 'Invoice',
      entityId: id,
      after: { amount: dto.amount, status: updated.status },
    });
    return { invoice: updated, payment };
  }

  private async patientScope(user: AuthUser, patientId?: string) {
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findFirst({ where: { userId: user.id } });
      return own ? { patientId: own.id } : { patientId: '__none__' };
    }
    return patientId ? { patientId } : {};
  }
}
