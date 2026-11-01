const pad = (n: number) => String(n).padStart(2, '0');

export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** Monday of the week containing the date. */
export function weekStart(iso: string): string {
  const d = parseISODate(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return todayISO(d);
}

const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function weekdayShort(iso: string): string {
  return WEEKDAYS_SHORT[parseISODate(iso).getDay()];
}

export function weekdayLong(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()];
}

export function humanDate(iso: string): string {
  const d = parseISODate(iso.slice(0, 10));
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function humanDateTime(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relativeDay(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Сегодня';
  if (iso === addDays(today, 1)) return 'Завтра';
  if (iso === addDays(today, -1)) return 'Вчера';
  return `${weekdayShort(iso)}, ${humanDate(iso)}`;
}

export function clock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function duration(totalSec: number | undefined): string {
  if (!totalSec) return '—';
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  if (s < 60) return `${s} с`;
  return `${m} мин`;
}

export function shortDuration(sec?: number): string {
  if (!sec) return '';
  if (sec < 60) return `${sec} с`;
  if (sec % 60 === 0) return `${sec / 60} мин`;
  return `${Math.floor(sec / 60)}:${pad(sec % 60)} мин`;
}

export function distance(m?: number): string {
  if (m == null) return '—';
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} км`;
}

export function pace(secPerKm?: number): string {
  if (!secPerKm || !isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${pad(s === 60 ? 0 : s)} /км`;
}

export function speedToPace(mps?: number): number | undefined {
  if (!mps || mps <= 0.3) return undefined;
  return 1000 / mps;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
