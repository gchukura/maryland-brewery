/**
 * Brewery opening hours: one parser and one clock for the whole site.
 *
 * Stored strings look like "12:00 – 10:00 PM" (en-dash) or "11:00 AM – 12:00 AM".
 * The opening time often has no AM/PM; it takes the closing time's meridiem unless that
 * would put opening after closing ("11:00 – 9:00 PM" is 11 AM to 9 PM, not 11 PM).
 * All "now" checks run in Maryland time, whatever the server's timezone.
 */

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type DayName = (typeof DAYS)[number];
export type WeeklyHours = Partial<Record<DayName, string>>;

export const MARYLAND_TZ = 'America/New_York';

const MINUTES_PER_DAY = 24 * 60;

/** Minutes after midnight. close > 1440 means the range runs past midnight. */
export interface TimeRange {
  open: number;
  close: number;
}

interface ParsedTime {
  hour: number;
  minute: number;
  meridiem: 'AM' | 'PM' | null;
}

const TIME = /(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?/;
const RANGE_SEPARATOR = /\s*(?:–|—|-|to)\s*/i;

function parseTime(text: string): ParsedTime | null {
  const match = text.trim().match(new RegExp(`^${TIME.source}$`));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 24 || minute > 59) return null;
  const meridiem = match[3] ? (match[3].replace(/[.\s]/g, '').toUpperCase() as 'AM' | 'PM') : null;
  return { hour, minute, meridiem };
}

function toMinutes({ hour, minute, meridiem }: ParsedTime, as: 'AM' | 'PM' | null): number {
  if (as === null) return (hour % 24) * 60 + minute; // 24-hour clock
  const h = hour % 12 + (as === 'PM' ? 12 : 0);
  return h * 60 + minute;
}

function parseRange(text: string): TimeRange | null {
  const parts = text.split(RANGE_SEPARATOR);
  if (parts.length !== 2) return null;
  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  if (!start || !end) return null;

  let close = toMinutes(end, end.meridiem);
  // "12:00 AM" as a closing time means midnight at the end of the day
  if (close === 0) close = MINUTES_PER_DAY;

  let open: number;
  if (start.meridiem) {
    open = toMinutes(start, start.meridiem);
  } else if (end.meridiem) {
    // Borrow the closing meridiem unless that opens after closing
    open = toMinutes(start, end.meridiem);
    if (open >= close) open = toMinutes(start, end.meridiem === 'PM' ? 'AM' : 'PM');
  } else {
    open = toMinutes(start, null);
  }

  if (close <= open) close += MINUTES_PER_DAY; // runs past midnight
  return { open, close };
}

/**
 * Parse one day's hours. Returns the open ranges, [] when closed, or null when the
 * string is missing or not understood.
 */
export function parseDayHours(text: string | null | undefined): TimeRange[] | null {
  if (!text || !text.trim()) return null;
  const value = text.trim();
  if (/closed/i.test(value)) return [];
  if (/open 24 hours|24\s*hours/i.test(value)) return [{ open: 0, close: MINUTES_PER_DAY }];
  const ranges = value.split(/\s*[,;]\s*/).map(parseRange);
  return ranges.every((r): r is TimeRange => r !== null) ? ranges : null;
}

/** Day of week and minutes after midnight for a moment, in the given timezone. */
export function zonedDayAndMinutes(date: Date, timeZone = MARYLAND_TZ): { day: DayName; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: get('weekday').toLowerCase() as DayName,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function previousDay(day: DayName): DayName {
  return DAYS[(DAYS.indexOf(day) + 6) % 7];
}

/** "4:00 PM", "12:00 AM" (midnight). Minutes past 1440 wrap to the next day. */
function formatMinutes(minutes: number): string {
  const m = minutes % MINUTES_PER_DAY;
  const h24 = Math.floor(m / 60);
  const meridiem = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${meridiem}`;
}

export interface OpenStatus {
  open: boolean;
  /** When open: the closing time, e.g. "10:00 PM". */
  closesAt?: string;
}

/** Whether the brewery is open at a moment (default: now), in Maryland time. */
export function isOpenAt(hours: WeeklyHours | null | undefined, date = new Date(), timeZone = MARYLAND_TZ): OpenStatus {
  if (!hours) return { open: false };
  const { day, minutes } = zonedDayAndMinutes(date, timeZone);

  for (const range of parseDayHours(hours[day]) ?? []) {
    if (minutes >= range.open && minutes < range.close) return { open: true, closesAt: formatMinutes(range.close) };
  }
  // Still inside yesterday's range that ran past midnight
  for (const range of parseDayHours(hours[previousDay(day)]) ?? []) {
    if (range.close > MINUTES_PER_DAY && minutes + MINUTES_PER_DAY < range.close) {
      return { open: true, closesAt: formatMinutes(range.close) };
    }
  }
  return { open: false };
}

export interface NextOpening {
  day: DayName;
  time: string;
  isToday: boolean;
}

/** The next time the brewery opens after a moment, within the coming week. */
export function nextOpening(hours: WeeklyHours | null | undefined, date = new Date(), timeZone = MARYLAND_TZ): NextOpening | null {
  if (!hours) return null;
  const { day, minutes } = zonedDayAndMinutes(date, timeZone);
  const start = DAYS.indexOf(day);
  for (let offset = 0; offset < 7; offset++) {
    const candidate = DAYS[(start + offset) % 7];
    const ranges = (parseDayHours(hours[candidate]) ?? [])
      .filter((r) => offset > 0 || r.open > minutes)
      .sort((a, b) => a.open - b.open);
    if (ranges.length > 0) return { day: candidate, time: formatMinutes(ranges[0].open), isToday: offset === 0 };
  }
  return null;
}

/** A day's hours for display with both meridiems spelled out: "12:00 PM – 10:00 PM", or "Closed". */
export function formatDayHours(text: string | null | undefined): string {
  const ranges = parseDayHours(text);
  if (ranges === null) return text?.trim() || 'Hours not available';
  if (ranges.length === 0) return 'Closed';
  return ranges.map((r) => `${formatMinutes(r.open)} – ${formatMinutes(r.close)}`).join(', ');
}

/** Today's hours in Maryland: "Today 12:00 PM – 10:00 PM", "Closed today", or null when unknown. */
export function todayHours(hours: WeeklyHours | null | undefined, date = new Date(), timeZone = MARYLAND_TZ): string | null {
  const text = hours?.[zonedDayAndMinutes(date, timeZone).day];
  const ranges = parseDayHours(text);
  if (ranges === null) return null;
  return ranges.length === 0 ? 'Closed today' : `Today ${formatDayHours(text)}`;
}

/** Whether the brewery has any opening hours on a given day. */
export function isOpenOnDay(hours: WeeklyHours | null | undefined, day: string): boolean {
  if (!hours || !(DAYS as readonly string[]).includes(day)) return false;
  return (parseDayHours(hours[day as DayName]) ?? []).length > 0;
}

export interface OpeningHoursSpecification {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string;
  opens: string;
  closes: string;
}

function to24h(minutes: number): string {
  const m = minutes % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** schema.org openingHoursSpecification entries for JSON-LD ("closes" past midnight wraps, e.g. "02:00"). */
export function openingHoursSpecification(hours: WeeklyHours | null | undefined): OpeningHoursSpecification[] {
  if (!hours) return [];
  return DAYS.flatMap((day) =>
    (parseDayHours(hours[day]) ?? []).map((range) => ({
      '@type': 'OpeningHoursSpecification' as const,
      dayOfWeek: day.charAt(0).toUpperCase() + day.slice(1),
      opens: to24h(range.open),
      closes: to24h(range.close),
    }))
  );
}

/** "10:00 PM" -> "10 PM"; "4:30 PM" stays. */
function shortTime(time: string): string {
  return time.replace(':00 ', ' ');
}

const DAY_ABBR: Record<DayName, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat',
};

export interface OpenStatusLabel {
  open: boolean;
  /** "Open until 10 PM", "Closed · opens 4 PM", "Closed · opens Thu 4 PM" */
  label: string;
}

/** The status badge text at a moment (default: now) in Maryland time; null when there are no usable hours. */
export function openStatusLabel(hours: WeeklyHours | null | undefined, date = new Date(), timeZone = MARYLAND_TZ): OpenStatusLabel | null {
  const status = isOpenAt(hours, date, timeZone);
  if (status.open && status.closesAt) return { open: true, label: `Open until ${shortTime(status.closesAt)}` };
  const next = nextOpening(hours, date, timeZone);
  if (!next) return null;
  return { open: false, label: `Closed · opens ${next.isToday ? '' : `${DAY_ABBR[next.day]} `}${shortTime(next.time)}` };
}
