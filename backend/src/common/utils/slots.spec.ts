import {
  deriveSlots,
  hasConflict,
  nextWeekday,
  overlaps,
  toHHMM,
  toMinutes,
} from './slots';

describe('slot helpers', () => {
  it('converts HH:MM to minutes and back', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toHHMM(570)).toBe('09:30');
    expect(toMinutes('00:00')).toBe(0);
  });

  it('derives a 30-minute grid inside working hours', () => {
    const slots = deriveSlots({
      weekday: 1,
      startTime: '09:00',
      endTime: '13:00',
      slotMinutes: 30,
      isOffline: false,
    });
    expect(slots).toHaveLength(8);
    expect(slots[0]).toEqual({ startTime: '09:00', endTime: '09:30', available: true });
    expect(slots[7].startTime).toBe('12:30');
    expect(slots[7].endTime).toBe('13:00');
  });

  it('marks booked slots unavailable', () => {
    const slots = deriveSlots(
      { weekday: 1, startTime: '09:00', endTime: '11:00', slotMinutes: 60, isOffline: false },
      ['10:00'],
    );
    expect(slots.find((s) => s.startTime === '10:00')?.available).toBe(false);
    expect(slots.find((s) => s.startTime === '09:00')?.available).toBe(true);
  });

  it('returns no slots for an offline day or a malformed range', () => {
    const offline = deriveSlots({
      weekday: 6,
      startTime: '09:00',
      endTime: '13:00',
      slotMinutes: 30,
      isOffline: true,
    });
    expect(offline).toEqual([]);

    const inverted = deriveSlots({
      weekday: 6,
      startTime: '13:00',
      endTime: '09:00',
      slotMinutes: 30,
      isOffline: false,
    });
    expect(inverted).toEqual([]);
  });

  it('detects overlapping windows but not back-to-back slots', () => {
    expect(overlaps('09:00', '10:00', '09:30', '10:30')).toBe(true);
    expect(overlaps('09:00', '10:00', '10:00', '11:00')).toBe(false);
    expect(overlaps('10:00', '11:00', '09:00', '10:00')).toBe(false);
  });

  it('flags a patient double booking inside an existing window', () => {
    const existing = [
      { startTime: '09:00', endTime: '09:30' },
      { startTime: '11:00', endTime: '11:30' },
    ];
    expect(hasConflict({ start: '09:30', end: '10:00' }, existing)).toBe(false);
    expect(hasConflict({ start: '11:15', end: '11:45' }, existing)).toBe(true);
  });

  it('rolls forward to the requested weekday', () => {
    const sunday = new Date('2025-04-13T12:00:00Z');
    expect(nextWeekday(sunday, 0).getUTCDay()).toBe(0);
    expect(nextWeekday(sunday, 1).toISOString().slice(0, 10)).toBe('2025-04-14');
    expect(nextWeekday(sunday, 6).toISOString().slice(0, 10)).toBe('2025-04-19');
  });
});
