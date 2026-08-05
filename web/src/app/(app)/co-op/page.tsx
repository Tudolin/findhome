import Link from 'next/link';
import KanbanBoard from '@/components/KanbanBoard';
import PartyPanel from '@/components/PartyPanel';
import ScoreBadge from '@/components/ScoreBadge';
import StarRating from '@/components/StarRating';
import { prisma } from '@/lib/prisma';
import { money } from '@/lib/format';
import { getBoard } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { UiProperty, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Co-Op Hub · FindHome' };

export default async function CoOpPage() {
  const ws = await resolveWorkspace();
  const cards = (await getBoard(ws)) as unknown as UiProperty[];

  const workspace: UiWorkspace = {
    kind: ws.kind,
    id: ws.partyId ?? 'solo',
    name: ws.name,
    members: ws.members,
    userId: ws.userId,
  };

  const party = ws.partyId
    ? await prisma.party.findUnique({
        where: { id: ws.partyId },
        include: { members: { include: { user: { select: { name: true } } }, orderBy: { joinedAt: 'asc' } } },
      })
    : null;

  const ranked = cards.filter((c) => c.partyScore.ratedCount > 0).slice(0, 10);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">Co-Op Hub</h1>
          <p className="mt-2 text-sm text-ink-500">
            {ws.kind === 'PARTY'
              ? `${ws.name} · ${ws.members.length} members · drag cards between columns to change status`
              : 'Solo mode — this board tracks only your own shortlist. Create a party to search with someone.'}
          </p>
        </div>
        <Link href="/dashboard" className="btn-ghost">
          Back to discovery
        </Link>
      </div>

      <PartyPanel
        activeParty={
          party
            ? {
                id: party.id,
                name: party.name,
                inviteCode: party.inviteCode,
                members: party.members.map((m) => ({ name: m.user.name, role: m.role })),
              }
            : null
        }
      />

      <section>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-600">Status board</h2>
        {cards.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-base font-bold text-ink-800">Nothing on the board yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
              Mark listings as Interested from{' '}
              <Link href="/dashboard" className="font-semibold text-brand-700 hover:text-brand-800">
                Discovery
              </Link>{' '}
              and they show up here.
            </p>
          </div>
        ) : (
          <KanbanBoard cards={cards} workspace={workspace} />
        )}
      </section>

      {ranked.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-sm font-bold uppercase tracking-wider text-ink-600">Ranked shortlist</h2>
          <p className="mb-4 max-w-3xl text-xs text-ink-500">
            Scored on average rating, how many members have weighed in, how much they agree, and how far the property
            got in the process. A rejection from any member heavily discounts the score.
          </p>

          <div className="card space-y-2 p-3">
            {ranked.map((card, index) => (
              <div key={card.id} className="flex flex-wrap items-center gap-4 rounded-xl px-3 py-3 shadow-neu-inset-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-black text-ink-500 shadow-neu-sm">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/property/${card.id}`}
                    className="block truncate text-sm font-bold text-ink-800 hover:text-brand-800"
                  >
                    {card.title}
                  </Link>
                  <p className="truncate text-xs text-ink-500">
                    {card.neighborhood} · {money(card.totalPrice)}/mo all-in · {card.bedrooms}bd · {card.sqm}m²
                  </p>
                </div>

                <div className="hidden items-center gap-4 sm:flex">
                  {workspace.members.map((m) => {
                    const it = card.interactions.find((i) => i.userId === m.userId);
                    return (
                      <div key={m.userId} className="text-center">
                        <StarRating value={it?.rating ?? null} readOnly size="sm" />
                        <p className="mt-0.5 text-[10px] font-semibold text-ink-500">
                          {m.userId === workspace.userId ? 'You' : m.name}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  {card.partyScore.conflict && (
                    <span className="chip !text-[10px] text-amber-800 shadow-neu-inset-sm" title="Ratings differ a lot">
                      needs a talk
                    </span>
                  )}
                  <ScoreBadge score={card.partyScore} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
