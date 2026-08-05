'use client';

import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { STATUS_DOT, STATUS_STYLE } from '@/lib/constants';
import { useT } from './LocaleProvider';

/**
 * Status pill. The colour lives in the dot and the text, never in a filled
 * background — a solid block would sit on top of the neumorphic surface
 * instead of being part of it.
 */
export default function StatusChip({
  status,
  size = 'md',
  className,
}: {
  status: InteractionStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const t = useT();

  return (
    <span
      className={clsx(STATUS_STYLE[status], size === 'sm' ? 'chip !px-2 !py-0.5 !text-[10px]' : 'chip', className)}
    >
      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
      {t.status[status]}
    </span>
  );
}
