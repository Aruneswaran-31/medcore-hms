/**
 * Pure scheduling helpers — no Prisma, no Nest, fully unit-testable.
 *
 * Availability decision (PRD §05): a repeating weekly schedule generates slots
 * on demand instead of materialising thousands of slot rows.
 */

export interface WeeklySchedule {
  weekday: number; // 0 = Sunday … 6 = Saturday
  startTime: string; // "09:00"
  endTime: string; // "13:00"
  slotMinutes: number;
  isOffline: boolean;
}

export interface Slot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Invalid time: ${hhmm}`);
  return h * 60 + m;
}

export function toHHMM(totalMinutes: number): string {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** true when [aStart,aEnd) intersects [bStart,bEnd). Times are "HH:MM" strings. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

/** Builds the slot grid for one day of a weekly schedule. */
export function deriveSlots(schedule: WeeklySchedule, booked: string[] = []): Slot[] {
  if (schedule.isOffline) return [];
  const start = toMinutes(schedule.startTime);
  const end = toMinutes(schedule.endTime);
  const step = Math.max(5, schedule.slotMinutes || 30);
  if (end <= start) return [];

  const slots: Slot[] = [];
  for (let cursor = start; cursor + step <= end; cursor += step) {
    const startTime = toHHMM(cursor);
    slots.push({
      startTime,
      endTime: toHHMM(cursor + step),
      available: !booked.includes(startTime),
    });
  }
  return slots;
}

/** True when the requested slot collides with an existing appointment. */
export function hasConflict(
  requested: { start: string; end: string },
  existing: Array<{ startTime: string; endTime: string }>,
): boolean {
  return existing.some((appt) => overlaps(requested.start, requested.end, appt.startTime, appt.endTime));
}

export function nextWeekday(from: Date, weekday: number): Date {
  const date = new Date(from);
  date.setUTCHours(0, 0, 0, 0);
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}