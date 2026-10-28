import { computeTotals } from './invoices/invoices.service';
import { flagResult } from './lab-orders/lab-orders.module';

describe('billing integrity', () => {
  it('total always equals the sum of line items minus discount plus tax', () => {
    const items = [
      { quantity: 1, unitPrice: 500 },
      { quantity: 2, unitPrice: 120.5, taxRate: 18 },
      { quantity: 3, unitPrice: 30 },
    ];
    const totals = computeTotals(items, 50);

    const expectedSubtotal = 500 + 2 * 120.5 + 3 * 30;
    const expectedTax = Number(((2 * 120.5 * 0.18) + (3 * 30 * 0)).toFixed(2));

    expect(totals.subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(totals.tax).toBeCloseTo(expectedTax, 2);
    expect(totals.total).toBeCloseTo(expectedSubtotal - 50 + expectedTax, 2);
  });

  it('never produces a negative total when the discount is larger than the subtotal', () => {
    const totals = computeTotals([{ quantity: 1, unitPrice: 100 }], 500);
    expect(totals.total).toBe(0);
    expect(totals.subtotal).toBe(100);
  });

  it('defaults to zero tax when no tax rate is configured', () => {
    const totals = computeTotals([{ quantity: 4, unitPrice: 25 }]);
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(100);
  });
});

describe('lab result flagging (PRD §07.5)', () => {
  const hb = { min: 13.0, max: 17.5 };

  it('marks values inside the reference range as NORMAL', () => {
    expect(flagResult(15.2, hb.min, hb.max)).toBe('NORMAL');
  });

  it('marks values outside the reference range LOW or HIGH', () => {
    expect(flagResult(11.4, hb.min, hb.max)).toBe('LOW');
    expect(flagResult(19.9, hb.min, hb.max)).toBe('HIGH');
  });

  it('returns null when there is no reference range or no value', () => {
    expect(flagResult(12, null, null)).toBeNull();
    expect(flagResult(undefined, hb.min, hb.max)).toBeNull();
  });

  it('handles one-sided reference ranges', () => {
    expect(flagResult(4, null, 10)).toBe('NORMAL');
    expect(flagResult(14, null, 10)).toBe('HIGH');
    expect(flagResult(14, 10, null)).toBe('NORMAL');
    expect(flagResult(4, 10, null)).toBe('LOW');
  });
});
