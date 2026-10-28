'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Modal, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { money, useApi } from '@/lib/use-api';
import type { InvoiceDto } from '@medcore/types';

type InvoiceRow = InvoiceDto & {
  patient?: { user?: { firstName: string; lastName: string }; mrn?: string } | null;
  payments?: Array<{ id: string; amount: string; method: string; status: string }>;
  items?: Array<{
    id: string;
    itemType: string;
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
};

const STATUSES = ['', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

export default function BillingPage() {
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = `/invoices?limit=50${status ? `&status=${status}` : ''}`;
  const list = useApi<InvoiceRow[]>(path);

  const rows = list.data ?? [];
  const detail = rows.find((r) => r.id === openId) ?? null;

  async function recordPayment(id: string) {
    const raw = window.prompt('Amount received (INR):');
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/invoices/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount, method: 'CASH' }),
      });
      setOpenId(null);
      list.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    } finally {
      setBusy(false);
    }
  }

  async function issue(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/invoices/${id}/issue`, { method: 'POST' });
      list.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue invoice.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<InvoiceRow>[] = [
    { header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.invoiceNumber}</span> },
    {
      header: 'Patient',
      cell: (i) => (
        <span className="text-slate-700">
          {i.patient?.user?.firstName} {i.patient?.user?.lastName}
        </span>
      ),
    },
    { header: 'Created', cell: (i) => new Date(i.createdAt).toLocaleDateString() },
    { header: 'Total', cell: (i) => <span className="tabular-nums">{money(i.total)}</span> },
    {
      header: 'Paid',
      cell: (i) => (
        <span className={`tabular-nums ${Number(i.amountPaid) > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
          {money(i.amountPaid)}
        </span>
      ),
    },
    { header: 'Status', cell: (i) => <Badge value={i.status} /> },
    {
      header: '',
      cell: (i) => (
        <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpenId(i.id)}>
          View
        </button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Invoices, collections and payment status."
        actions={
          <select className="input max-w-[13rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
      />

      {list.loading ? (
        <Spinner label="Loading invoices…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(i) => i.id} empty="No invoices found." />
      )}

      <Modal title="Invoice detail" open={Boolean(detail)} onClose={() => setOpenId(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm font-semibold text-slate-900">{detail.invoiceNumber}</p>
                <p className="text-xs text-slate-500">
                  {detail.patient?.user?.firstName} {detail.patient?.user?.lastName} ·{' '}
                  {new Date(detail.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Badge value={detail.status} />
            </div>

            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-slate-50">
                  <th className="th">Item</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Unit</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(detail.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="td">
                      <p className="font-medium text-slate-800">{item.description}</p>
                      <p className="text-xs text-slate-500">{item.itemType}</p>
                    </td>
                    <td className="td text-right">{item.quantity}</td>
                    <td className="td text-right">{money(item.unitPrice)}</td>
                    <td className="td text-right">{money(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="card p-4 text-sm">
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="tabular-nums">{money(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Discount</span>
                  <span className="tabular-nums">{money(detail.discount)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Tax</span>
                  <span className="tabular-nums">{money(detail.tax)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{money(detail.total)}</span>
                </div>
                <div className="flex justify-between py-0.5 text-emerald-600">
                  <span>Paid</span>
                  <span className="tabular-nums">{money(detail.amountPaid)}</span>
                </div>
              </div>

              <div className="card p-4">
                <p className="label">Payments</p>
                {(detail.payments ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">No payments recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {detail.payments!.map((p) => (
                      <li key={p.id} className="flex justify-between">
                        <span className="text-slate-600">{p.method}</span>
                        <span className="tabular-nums text-slate-800">{money(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

            <div className="flex justify-end gap-2">
              {detail.status === 'DRAFT' ? (
                <button className="btn-ghost" disabled={busy} onClick={() => issue(detail.id)}>
                  Issue invoice
                </button>
              ) : null}
              {['ISSUED', 'PARTIALLY_PAID'].includes(detail.status) ? (
                <button className="btn-primary" disabled={busy} onClick={() => recordPayment(detail.id)}>
                  {busy ? 'Recording…' : 'Record payment'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
