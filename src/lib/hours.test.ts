import { describe, expect, it } from 'vitest';
import { formatDayHours, isOpenAt, todayHours, isOpenOnDay, nextOpening, openingHoursSpecification, openStatusLabel, parseDayHours, type WeeklyHours } from './hours';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('parseDayHours: real strings from the breweries table', () => {
  // [stored string, open (minutes), close (minutes; > 1440 = after midnight)]
  const cases: [string, number, number][] = [
    ['12:00 – 10:00 PM', h(12), h(22)], // noon, not midnight
    ['3:00 – 9:00 PM', h(15), h(21)],
    ['11:00 AM – 10:00 PM', h(11), h(22)],
    ['11:00 – 9:00 PM', h(11), h(21)], // the AM/PM bug: 11 AM, not 11 PM
    ['11:30 AM – 10:00 PM', h(11, 30), h(22)],
    ['11:00 AM – 12:00 AM', h(11), h(24)], // closes at midnight
    ['12:00 PM – 12:00 AM', h(12), h(24)],
    ['11:00 AM – 1:00 AM', h(11), h(25)], // past midnight
    ['12:00 PM – 2:00 AM', h(12), h(26)],
    ['4:00 PM – 12:00 AM', h(16), h(24)],
    ['10:00 – 10:30 AM', h(10), h(10, 30)],
    ['9:00 AM – 5:00 PM', h(9), h(17)],
    ['12:00 – 9:30 PM', h(12), h(21, 30)],
    ['5:30 – 9:00 PM', h(17, 30), h(21)],
    ['1:00 – 6:00 PM', h(13), h(18)],
    ['10:00 AM – 11:00 PM', h(10), h(23)],
    ['11:00 AM - 9:00 PM', h(11), h(21)], // plain hyphen
    ['11:00-21:00', h(11), h(21)], // 24-hour
  ];

  it.each(cases)('%s', (text, open, close) => {
    expect(parseDayHours(text)).toEqual([{ open, close }]);
  });

  it('handles closed, 24 hours, split shifts and junk', () => {
    expect(parseDayHours('Closed')).toEqual([]);
    expect(parseDayHours('Open 24 hours')).toEqual([{ open: 0, close: h(24) }]);
    expect(parseDayHours('11:00 AM – 2:00 PM, 5:00 – 9:00 PM')).toEqual([
      { open: h(11), close: h(14) },
      { open: h(17), close: h(21) },
    ]);
    expect(parseDayHours('')).toBeNull();
    expect(parseDayHours(undefined)).toBeNull();
    expect(parseDayHours('by appointment')).toBeNull();
  });
});

describe('isOpenAt (Maryland time, whatever the server timezone)', () => {
  const hours: WeeklyHours = {
    monday: 'Closed',
    tuesday: '11:00 – 9:00 PM',
    wednesday: '12:00 PM – 2:00 AM',
    friday: '12:00 PM – 2:00 AM',
    saturday: '11:00 AM – 12:00 AM',
  };

  it('uses Maryland time, not UTC', () => {
    // 16:00 UTC is noon on Tuesday in Maryland (EDT)
    expect(isOpenAt(hours, new Date('2026-10-27T16:00:00Z'))).toEqual({ open: true, closesAt: '9:00 PM' });
    // 02:30 UTC Wednesday is 10:30 PM Tuesday in Maryland: closed
    expect(isOpenAt(hours, new Date('2026-10-28T02:30:00Z')).open).toBe(false);
  });

  it("stays open past midnight on the previous day's hours", () => {
    // 1:30 AM Saturday, Friday's hours run to 2 AM
    expect(isOpenAt(hours, new Date('2026-10-31T05:30:00Z'))).toEqual({ open: true, closesAt: '2:00 AM' });
    // 1:30 AM Wednesday: Tuesday closed at 9 PM
    expect(isOpenAt(hours, new Date('2026-10-28T05:30:00Z')).open).toBe(false);
  });

  it('treats missing hours as closed', () => {
    expect(isOpenAt(undefined).open).toBe(false);
  });
});

describe('nextOpening, formatDayHours, isOpenOnDay', () => {
  const hours: WeeklyHours = { monday: 'Closed', tuesday: '11:00 – 9:00 PM', thursday: '4:00 – 10:00 PM' };

  it('finds the next opening in Maryland time', () => {
    // Tuesday 10:30 PM: next is Thursday 4 PM
    expect(nextOpening(hours, new Date('2026-10-28T02:30:00Z'))).toEqual({ day: 'thursday', time: '4:00 PM', isToday: false });
    // Tuesday 8:00 AM: opens later today
    expect(nextOpening(hours, new Date('2026-10-27T12:00:00Z'))).toEqual({ day: 'tuesday', time: '11:00 AM', isToday: true });
  });

  it('spells out both meridiems for display', () => {
    expect(formatDayHours('12:00 – 10:00 PM')).toBe('12:00 PM – 10:00 PM');
    expect(formatDayHours('11:00 AM – 12:00 AM')).toBe('11:00 AM – 12:00 AM');
    expect(formatDayHours('Closed')).toBe('Closed');
  });

  it('knows which days have hours', () => {
    expect(isOpenOnDay(hours, 'tuesday')).toBe(true);
    expect(isOpenOnDay(hours, 'monday')).toBe(false);
    expect(isOpenOnDay(hours, 'wednesday')).toBe(false);
  });
});

describe('openingHoursSpecification', () => {
  it('emits 24-hour times with the AM/PM fix applied', () => {
    expect(openingHoursSpecification({ tuesday: '11:00 – 9:00 PM', friday: '12:00 PM – 2:00 AM', monday: 'Closed' })).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Tuesday', opens: '11:00', closes: '21:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Friday', opens: '12:00', closes: '02:00' },
    ]);
  });
});

describe('openStatusLabel (the status badge)', () => {
  const hours: WeeklyHours = { monday: 'Closed', tuesday: '11:00 – 9:00 PM', thursday: '4:30 – 10:00 PM' };

  it('reads like the design: "Open until 9 PM", "Closed · opens Thu 4:30 PM"', () => {
    expect(openStatusLabel(hours, new Date('2026-10-27T16:00:00Z'))).toEqual({ open: true, label: 'Open until 9 PM' });
    expect(openStatusLabel(hours, new Date('2026-10-28T02:30:00Z'))).toEqual({ open: false, label: 'Closed · opens Thu 4:30 PM' });
    expect(openStatusLabel(hours, new Date('2026-10-27T12:00:00Z'))).toEqual({ open: false, label: 'Closed · opens 11 AM' });
  });

  it('is null without usable hours', () => {
    expect(openStatusLabel({}, new Date('2026-10-27T16:00:00Z'))).toBeNull();
    expect(openStatusLabel(undefined)).toBeNull();
  });
});

describe('todayHours', () => {
  const hours: WeeklyHours = { tuesday: '12:00 – 10:00 PM', wednesday: 'Closed' };
  // 2026-11-17 is a Tuesday; 03:00 UTC Wednesday is still Tuesday evening in Maryland
  it("uses Maryland's day, not the server's", () => {
    expect(todayHours(hours, new Date('2026-11-18T03:00:00Z'))).toBe('Today 12:00 PM – 10:00 PM');
    expect(todayHours(hours, new Date('2026-11-18T15:00:00Z'))).toBe('Closed today');
  });
  it('is null when the day has no readable hours', () => {
    expect(todayHours(hours, new Date('2026-11-19T15:00:00Z'))).toBeNull();
    expect(todayHours(undefined)).toBeNull();
  });
});
