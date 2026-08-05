'use client';

import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { STATUS_DOT, STATUS_LABEL } from '@/lib/constants';

const CHOICES: InteractionStatus[] = ['INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED'];

export default function StatusPicker({
  value,
  onChange,
  disabled,
}: {
  value: InteractionStatus | null;
  onChange: (status: InteractionStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHOICES.map((status) => {
        const selected = value === status;
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(status)}
            className={clsx(
              'chip cursor-pointer transition-all duration-150 ease-neu disabled:opacity-50',
              selected ? 'pressed-on' : 'pressed-off',
            )}
          >
            <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
            {STATUS_LABEL[status]}
          </button>
        );
      })}
    </div>
  );
}
