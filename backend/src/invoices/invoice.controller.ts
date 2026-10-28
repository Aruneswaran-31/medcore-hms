import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { InvoicesService } from './invoices.service';
import { Public, Roles } from '../common/decorators/auth.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateInvoiceDto, PaymentDto } from './invoice.dto';

export type SignedRequest = RawBodyRequest<Request>;

/** Constant-time Stripe webhook signature check (PRD §07.7). */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((pair) => pair.split('=') as [string, string]),
  );
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  // Reject replayed payloads older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

@ApiTags('billing')
@ApiBearerAuth('bearer')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Create a draft invoice with line items' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.invoices.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List invoices with status filters' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.invoices.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Invoice detail with items and payments' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.findOne(id, user);
  }

  @Post(':id/issue')
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Finalise a draft invoice and share it with the patient' })
  issue(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.issue(id, user);
  }

  @Post(':id/pay')
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'PATIENT')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a counter payment (cash / insurance / verified gateway)' })
  pay(@Param('id') id: string, @Body() dto: PaymentDto, @CurrentUser() user: AuthUser) {
    return this.invoices.recordPayment(id, dto, user);
  }
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly invoices: InvoicesService) {}

  @Public()
  @Post('webhook/stripe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook — signature verified, never trusted from the client' })
  async stripeWebhook(@Req() req: SignedRequest, @Body() body: any) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    const header = req.headers['stripe-signature'] as string | undefined;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));

    if (!verifyStripeSignature(raw, header, secret)) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed.',
      });
    }

    const event = body as { type?: string; data?: { object?: any } };
    if (event.type === 'payment_intent.succeeded' || event.type === 'checkout.session.completed') {
      const object = event.data?.object ?? {};
      const invoiceId = object.metadata?.invoiceId;
      const amount = Number(object.amount_received ?? object.amount ?? 0) / 100;
      if (invoiceId && amount > 0) {
        const systemUser: AuthUser = {
          id: 'stripe-webhook',
          email: 'webhook@stripe.local',
          role: 'SUPER_ADMIN',
          hospitalId: null,
          firstName: 'Stripe',
          lastName: 'Webhook',
        };
        await this.invoices.recordPayment(
          invoiceId,
          { amount, method: 'CARD', provider: 'STRIPE', providerReference: object.id },
          systemUser,
        );
      }
    }
    return { received: true };
  }
}
