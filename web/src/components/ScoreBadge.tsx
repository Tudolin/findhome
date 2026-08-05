'use client';

import clsx from 'clsx';
import { useT } from './LocaleProvider';
import type { PartyScore } from '@/lib/scoring';

/**
 * Compact readout of the Party Ranking Engine result.
 *
 * Rendered as a pressed well so it sits inside the card surface rather than on
 * top of it; the score band is carried by the text colour and the ring.
 * Hovering shows the breakdown so the number never looks arbitrary.
 */
export default function ScoreBadge({ score, compact = false }: { score: PartyScore; compact?: boolean }) {
  const t = useT();

  const tone =
    score.vetoed || score.score < 30
      ? 'text-danger'
      : score.score >= 70
        ? 'text-brand-700'
        : score.score >= 45
          ? 'text-warning'
          : 'text-ink-600';

  const title = [
    `${t.property.partyScore} ${score.score}/100`,
    score.avgRating != null
      ? `${score.avgRating}★ (${score.ratedCount}/${score.memberCount})`
      : t.property.rating.toLowerCase(),
    score.conflict ? `${t.property.needsATalk}: ${score.spread}★` : null,
    score.vetoed ? t.status.REJECTED : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={clsx('chip bg-surface tabular-nums shadow-neu-inset-sm', tone)}
      title={title}
      aria-label={title}
    >
      <strong className="text-sm font-black leading-none">{score.score}</strong>
      {!compact && (
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{t.property.partyScore}</span>
      )}
      {score.conflict && <span title={t.property.needsATalk}>⚡</span>}
      {score.vetoed && <span title={t.status.REJECTED}>🚫</span>}
    </span>
  );
}
