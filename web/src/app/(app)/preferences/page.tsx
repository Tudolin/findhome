import PreferencesForm from '@/components/PreferencesForm';
import { prisma } from '@/lib/prisma';
import { getPreferenceProfile } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preferences · FindHome' };

export default async function PreferencesPage() {
  const ws = await resolveWorkspace();
  const profile = await getPreferenceProfile(ws);

  // Suggest neighborhoods that actually exist in the scraped data for the
  // configured city, so the tag picker is never a blank slate.
  const rows = await prisma.property.groupBy({
    by: ['neighborhood'],
    where: profile?.city ? { city: { equals: profile.city, mode: 'insensitive' } } : {},
    _count: { neighborhood: true },
    orderBy: { _count: { neighborhood: 'desc' } },
    take: 30,
  });

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

      <PreferencesForm
        profile={profile}
        workspaceName={ws.name}
        workspaceKind={ws.kind}
        knownNeighborhoods={rows.map((r) => r.neighborhood)}
      />
    </div>
  );
}
