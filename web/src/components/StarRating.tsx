'use client';

import clsx from 'clsx';

export default function StarRating({
  value,
  onChange,
  readOnly = false,
  size = 'md',
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md';
}) {
  const stars = [1, 2, 3, 4, 5];

  if (readOnly) {
    return (
      <div className={clsx('flex items-center gap-0.5', size === 'sm' ? 'text-xs' : 'text-base')}>
        {stars.map((star) => (
          <span
            key={star}
            aria-hidden
            className={value != null && star <= value ? 'text-amber-500' : 'text-ink-300'}
          >
            ★
          </span>
        ))}
        <span className="sr-only">{value ? `${value} out of 5` : 'not rated'}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 shadow-neu-inset-sm">
      {stars.map((star) => {
        const filled = value != null && star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            aria-pressed={filled}
            // Clicking the current rating clears it.
            onClick={() => onChange?.(value === star ? null : star)}
            className={clsx(
              'cursor-pointer leading-none transition-transform duration-100 hover:scale-125',
              size === 'sm' ? 'text-sm' : 'text-lg',
              filled ? 'text-amber-500' : 'text-ink-300',
            )}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
