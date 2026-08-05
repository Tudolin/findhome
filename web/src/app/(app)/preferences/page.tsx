import Link from 'next/link';
import PreferencesForm from '@/components/PreferencesForm';
import { prisma } from '@/lib/prisma';
import { locationSlug } from '@/lib/locations';
import { preferenceWarnings } from '@/lib/matching';
import { getPreferenceProfile } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preferences · FindHome' };

export default async function PreferencesPage() {
  const ws = await resolveWorkspace();
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
        <h1 className="text-2xl font-black tracking-tight text-ink-900">Search preferences</h1>
        <p className="mt-2 text-sm text-ink-500">
          {ws.kind === 'PARTY'
            ? `Shared by everyone in ${ws.name}. Changes apply to the whole party's feed.`
            : 'Private to your personal search. Party workspaces keep their own separate profile.'}
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="mb-5 rounded-2xl bg-surface px-5 py-3.5 shadow-neu">
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-700">
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
      />

      <p className="mt-5 text-center text-xs text-ink-400">
        Saving here changes what the scraper looks for on its next run. To pull listings immediately, use{' '}
        <Link href="/dashboard" className="font-semibold text-brand-700 hover:text-brand-800">
          Scrape now
        </Link>{' '}
        on the discovery feed.
      </p>
    </div>
  );
}
