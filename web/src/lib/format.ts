const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const money = (value: number | null | undefined) => (value == null ? '—' : BRL.format(value));

export const area = (sqm: number) => (sqm > 0 ? `${sqm} m²` : '—');

/**
 * PropertySource enum value -> the portal's actual name.
 *
 * An explicit table rather than string munging: `source.replace('_', ' ')`
 * replaces only the FIRST underscore, so CHAVES_NA_MAO rendered as
 * "CHAVES NA_MAO". Names are also not mechanically derivable — "IMOVELWEB" is
 * written "ImovelWeb" and "ZAP" is "Zap Imóveis".
 */
const SOURCE_LABEL: Record<string, string> = {
  ZAP: 'Zap Imóveis',
  VIVA_REAL: 'Viva Real',
  QUINTO_ANDAR: 'QuintoAndar',
  OLX: 'OLX',
  CHAVES_NA_MAO: 'Chaves na Mão',
  IMOVELWEB: 'ImovelWeb',
  MANUAL: 'Added by hand',
  DEMO: 'Demo',
};

export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source.split('_').join(' ');

export function relativeDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours <= 0) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString('pt-BR');
}
