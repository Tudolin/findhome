/** Helpers shared by the portal parsers. */

/** "São Paulo" -> "sao-paulo" */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Portals return money as numbers, numeric strings, or formatted strings
 * ("R$ 3.200", "3.200,00"). Normalise everything to whole BRL.
 */
export function toMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return 0;

  const cleaned = value.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  // pt-BR: '.' groups thousands, ',' is the decimal separator.
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/\./g, '');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function toInt(value: unknown, fallback = 0): number {
  if (Array.isArray(value)) return toInt(value[0], fallback);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return fallback;
}

export function first<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Trims, collapses whitespace and caps length so titles stay sane. */
export function clean(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Very loose pet-policy detection from free text. Returns null (unknown)
 * rather than false when nothing matches — a wrong `false` would hide
 * perfectly good listings from anyone filtering on pets.
 */
export function detectPetPolicy(text: string): boolean | null {
  const haystack = text.toLowerCase();
  if (/n[aã]o\s+aceita\s+(pet|animai)/.test(haystack)) return false;
  if (/(aceita\s+pet|pet\s*friendly|permitido\s+animais|aceita\s+animais)/.test(haystack)) return true;
  return null;
}
