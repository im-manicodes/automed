export const DEFAULT_REPORT_ZONE = 'America/Mexico_City';
export const DEFAULT_REPORT_HOUR = '07:00';

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const isValidHour = (h: unknown): h is string =>
  typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/** Fecha 'YYYY-MM-DD' y hora 'HH:mm' locales de `now` en la zona dada. */
export function localParts(
  now: Date,
  zone: string,
): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    fecha: `${g('year')}-${g('month')}-${g('day')}`,
    hora: `${g('hour')}:${g('minute')}`,
  };
}

/** ¿Ya pasó la hora programada hoy (hora local)? Comparación lexicográfica de 'HH:mm'. */
export const isDue = (now: Date, zone: string, hora: string) =>
  localParts(now, zone).hora >= hora;
