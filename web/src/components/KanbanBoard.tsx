'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { BOARD_COLUMNS, STATUS_DOT, STATUS_LABEL } from '@/lib/constants';
import { updateInteraction } from '@/lib/client';
import { money } from '@/lib/format';
import type { UiProperty, UiWorkspace } from '@/lib/types';
import ScoreBadge from './ScoreBadge';
import StarRating from './StarRating';

/**
 * Status board. Columns are driven by the *party's* best status so both
 * partners see the same card in the same place; dragging updates only the
 * current user's own interaction row.
 */
export default function KanbanBoard({ cards, workspace }: { cards: UiProperty[]; workspace: UiWorkspace }) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<InteractionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const byColumn = (status: InteractionStatus) => cards.filter((c) => c.partyScore.bestStatus === status);

  async function move(propertyId: string, status: InteractionStatus) {
    setError(null);
    try {
      await updateInteraction(propertyId, { status });
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      {error && <p className="well-sm mb-4 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      <div className="scrollbar-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4">
        {BOARD_COLUMNS.map((status) => {
          const column = byColumn(status);
          const isTarget = hover === status;
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setHover(status);
              }}
              onDragLeave={() => setHover((h) => (h === status ? null : h))}
              onDrop={(e) => {
                e.preventDefault();
                setHover(null);
                const id = dragging ?? e.dataTransfer.getData('text/plain');
                if (id) void move(id, status);
                setDragging(null);
              }}
              className={clsx(
                'flex w-[19rem] shrink-0 flex-col rounded-2xl bg-surface p-3 transition-all duration-200 ease-neu',
                isTarget ? 'shadow-neu-inset ring-2 ring-brand-300' : 'shadow-neu-inset-sm',
              )}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-600">
                  <span className={clsx('h-2 w-2 rounded-full', STATUS_DOT[status])} />
                  {STATUS_LABEL[status]}
                </span>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-surface px-2 text-[11px] font-bold text-ink-600 shadow-neu-sm">
                  {column.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-3">
                {column.map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={(e) => {
                      setDragging(card.id);
                      e.dataTransfer.setData('text/plain', card.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={clsx(
                      'cursor-grab rounded-xl bg-surface p-3 shadow-neu transition-all duration-150 active:cursor-grabbing',
                      dragging === card.id && 'opacity-40 shadow-neu-inset-sm',
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <Link
                        href={`/property/${card.id}`}
                        className="line-clamp-2 text-xs font-bold leading-snug text-ink-800 hover:text-brand-800"
                      >
                        {card.title}
                      </Link>
                      <ScoreBadge score={card.partyScore} compact />
                    </div>

                    <p className="text-[11px] font-medium text-ink-500">
                      {card.neighborhood} · {money(card.totalPrice)}/mo · {card.bedrooms}bd · {card.sqm}m²
                    </p>

                    {(card.partyScore.sharedPros.length > 0 || card.partyScore.sharedCons.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.partyScore.sharedPros.slice(0, 2).map((p) => (
                          <span key={p} className="chip tint-pro !px-2 !py-0.5 !text-[10px]">
                            ✓ {p}
                          </span>
                        ))}
                        {card.partyScore.sharedCons.slice(0, 2).map((c) => (
                          <span key={c} className="chip tint-con !px-2 !py-0.5 !text-[10px]">
                            ✕ {c}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="well-sm mt-2.5 space-y-1 px-2.5 py-2">
                      {workspace.members.map((m) => {
                        const it = card.interactions.find((i) => i.userId === m.userId);
                        return (
                          <div key={m.userId} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate font-semibold text-ink-600">
                              {m.userId === workspace.userId ? 'You' : m.name}
                            </span>
                            {it ? (
                              <StarRating value={it.rating} readOnly size="sm" />
                            ) : (
                              <span className="text-ink-400">no input</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {card.commentCount > 0 && (
                      <p className="mt-2 text-[11px] font-semibold text-ink-500">💬 {card.commentCount}</p>
                    )}
                  </article>
                ))}

                {column.length === 0 && (
                  <p className="rounded-xl px-4 py-8 text-center text-[11px] font-medium text-ink-400">
                    Drag a card here
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
