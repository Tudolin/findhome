import clsx from 'clsx';
import type { PartyScore } from '@/lib/scoring';

/**
 * Compact readout of the Party Ranking Engine result.
 *
 * Rendered as a pressed well so it sits inside the card surface rather than on
 * top of it; the score band is carried by the text colour and the ring.
 * Hovering shows the breakdown so the number never looks arbitrary.
 */
export default function ScoreBadge({ score, compact = false }: { score: PartyScore; compact?: boolean }) {
  const tone =
    score.vetoed || score.score < 30
      ? 'text-rose-700'
      : score.score >= 70
        ? 'text-brand-800'
        : score.score >= 45
          ? 'text-amber-800'
          : 'text-ink-600';

  const title = [
    `Match score ${score.score}/100`,
    score.avgRating != null
      ? `avg ${score.avgRating}★ from ${score.ratedCount}/${score.memberCount} members`
      : 'not rated yet',
    score.conflict ? `disagreement: ${score.spread}★ apart` : null,
    score.vetoed ? 'archived by a member' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={clsx('chip bg-surface shadow-neu-inset-sm tabular-nums', tone)}
      title={title}
      aria-label={title}
    >
      <strong className="text-sm font-black leading-none">{score.score}</strong>
      {!compact && <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">match</span>}
      {score.conflict && <span title="Members disagree by 3+ stars">⚡</span>}
      {score.vetoed && <span title="Archived by a member">🚫</span>}
    </span>
  );
}
