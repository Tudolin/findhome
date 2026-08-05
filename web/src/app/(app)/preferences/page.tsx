import Link from 'next/link';
import PreferencesForm from '@/components/PreferencesForm';
import { prisma } from '@/lib/prisma';
import { getDictionary } from '@/lib/i18n/server';
import { locationSlug } from '@/lib/locations';
import { preferenceWarnings } from '@/lib/matching';
import { getPreferenceProfile } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preferences · FindHome' };

/**
 * Whether the server can actually deliver a WhatsApp message.
 *
 * Read here rather than in the client component: it is server-side config, and
 * the form only needs to know whether to warn that alerts will go nowhere yet.
 * Must stay in step with configuredProvider() in the scraper's notify/whatsapp.
 */
function whatsappConfigured(): boolean {
  const provider = (process.env.WHATSAPP_PROVIDER ?? '').trim().toLowerCase();
  return provider === 'webhook' || provider === 'cloud' || provider === 'callmebot';
}

export default async function PreferencesPage() {
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);
  const profile = await getPreferenceProfile(ws);

  // Suggest neighborhoods that actually exist in the scraped data for the
  // configured city. Grouped by the slug column so one neighborhood the portals
  // spell three ways does not produce three suggestions; the display spelling
  // comes back from `neighborhood` for readability.
  const citySlug = profile ? profile.citySlug || locationSlug(profile.city) : '';
  const rows = citySlug
    ? await prisma.property.groupBy({
        by: ['neighborhoodSlug', 'neighborhood'],
        where: { citySlug, active: true },
        _count: { neighborhoodSlug: true },
        orderBy: { _count: { neighborhoodSlug: 'desc' } },
        take: 60,
      })
    : [];

  const seen = new Set<string>();
  const knownNeighborhoods: string[] = [];
  for (const row of rows) {
    if (seen.has(row.neighborhoodSlug)) continue;
    seen.add(row.neighborhoodSlug);
    knownNeighborhoods.push(row.neighborhood);
  }

  const warnings = preferenceWarnings(profile);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.preferences.title}</h1>
        <p className="mt-2 text-sm text-ink-500">
          {ws.kind === 'PARTY' ? t.preferences.subtitleParty(ws.name) : t.preferences.subtitleSolo}
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="mb-5 rounded-2xl bg-surface px-5 py-3.5 shadow-neu">
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-warning">
              {warning}
            </p>
          ))}
        </div>
      )}

      <PreferencesForm
        profile={profile}
        workspaceName={ws.name}
        workspaceKind={ws.kind}
        knownNeighborhoods={knownNeighborhoods}
        whatsappConfigured={whatsappConfigured()}
      />

      <p className="mt-5 text-center text-xs text-ink-400">
        {t.preferences.scrapeHint}{' '}
        <Link href="/dashboard" className="font-semibold text-brand-700 hover:text-brand-800">
          {t.scrape.now}
        </Link>{' '}
        {t.preferences.onTheFeed}
      </p>
    </div>
  );
}
