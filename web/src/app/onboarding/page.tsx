import { redirect } from 'next/navigation';
import OnboardingWizard from '@/components/OnboardingWizard';
import { getDictionary } from '@/lib/i18n/server';
import { getPreferenceProfile } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bem-vindo · FindHome' };

/**
 * First run.
 *
 * Without preferences the feed has nothing to filter by and the scraper has
 * nothing to search for, so a new account used to land on an empty Discovery page
 * with a link to a settings screen — which is the moment most people decide the
 * app does not work.
 *
 * Three questions, and then a real feed. `(app)/layout.tsx` sends anyone without
 * a profile here; finishing writes the profile, which is what makes the redirect
 * stop.
 *
 * ## Why it lives outside the (app) route group
 *
 * So it does not get the navigation rail — a wizard with an escape hatch on every
 * side is a wizard nobody finishes — and, more practically, so the layout that
 * performs the redirect never runs for the page it redirects *to*. A layout
 * cannot read its own pathname, so keeping the two apart is what stops the loop
 * without plumbing the path through a header.
 *
 * Still behind auth: the middleware protects everything that is not explicitly
 * public, and this is not.
 */
export default async function OnboardingPage() {
  const ws = await resolveWorkspace();
  const [profile, t] = await Promise.all([getPreferenceProfile(ws), getDictionary()]);

  // Already configured — arriving by hand, or via a stale link after finishing.
  if (profile) redirect('/dashboard');

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <OnboardingWizard
        workspaceName={ws.name}
        isParty={ws.kind === 'PARTY'}
        greeting={t.onboarding.title}
      />
    </main>
  );
}
