'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { QUICK_CONS, QUICK_PROS } from '@/lib/constants';

/**
 * Pros/cons badge editor. Quick-pick chips cover the common cases; the free
 * text field handles everything else.
 *
 * Selected tags are pressed into the surface and coloured (green / red);
 * unselected suggestions sit raised above it.
 */
export default function ProsConsEditor({
  pros,
  cons,
  onChange,
  disabled,
}: {
  pros: string[];
  cons: string[];
  onChange: (next: { pros: string[]; cons: string[] }) => void;
  disabled?: boolean;
}) {
  const [draftPro, setDraftPro] = useState('');
  const [draftCon, setDraftCon] = useState('');

  const toggle = (kind: 'pros' | 'cons', label: string) => {
    const current = kind === 'pros' ? pros : cons;
    const next = current.some((l) => l.toLowerCase() === label.toLowerCase())
      ? current.filter((l) => l.toLowerCase() !== label.toLowerCase())
      : [...current, label];
    onChange({ pros: kind === 'pros' ? next : pros, cons: kind === 'cons' ? next : cons });
  };

  const add = (kind: 'pros' | 'cons', raw: string) => {
    const label = raw.trim();
    if (!label) return;
    const current = kind === 'pros' ? pros : cons;
    if (current.some((l) => l.toLowerCase() === label.toLowerCase())) return;
    onChange({ pros: kind === 'pros' ? [...pros, label] : pros, cons: kind === 'cons' ? [...cons, label] : cons });
  };

  const section = (
    kind: 'pros' | 'cons',
    title: string,
    values: string[],
    quick: string[],
    draft: string,
    setDraft: (v: string) => void,
  ) => (
    <div>
      <p className="label">{title}</p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {values.map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => toggle(kind, label)}
            className={clsx('chip', kind === 'pros' ? 'tint-pro' : 'tint-con')}
            title="Remove"
          >
            {label} <span className="opacity-50">×</span>
          </button>
        ))}
        {values.length === 0 && <span className="text-xs text-ink-400">Nothing yet</span>}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {quick
          .filter((label) => !values.some((v) => v.toLowerCase() === label.toLowerCase()))
          .map((label) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => toggle(kind, label)}
              className="tag-toggle"
            >
              + {label}
            </button>
          ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input !py-2 text-xs"
          placeholder={kind === 'pros' ? 'Add a pro…' : 'Add a con…'}
          aria-label={kind === 'pros' ? 'Add a pro' : 'Add a con'}
          value={draft}
          disabled={disabled}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(kind, draft);
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          className="btn-ghost !py-2 !text-xs"
          disabled={disabled || !draft.trim()}
          onClick={() => {
            add(kind, draft);
            setDraft('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {section('pros', 'Pros', pros, QUICK_PROS, draftPro, setDraftPro)}
      {section('cons', 'Cons', cons, QUICK_CONS, draftCon, setDraftCon)}
    </div>
  );
}
