'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { PreferenceProfile } from '@prisma/client';
import { AMENITY_OPTIONS } from '@/lib/constants';
import { savePreferences } from '@/lib/client';
import { money } from '@/lib/format';

type FormState = {
  city: string;
  neighborhoods: string[];
  listingType: 'RENT' | 'SALE';
  minPrice: number;
  maxPrice: number;
  includeCondoInMaxPrice: boolean;
  minBedrooms: number;
  minBathrooms: number;
  minParkingSpots: number;
  minSqm: number;
  petFriendly: boolean;
  amenities: string[];
};

const PRICE_CEILING = 20000;

function initial(profile: PreferenceProfile | null): FormState {
  return {
    city: profile?.city ?? '',
    neighborhoods: profile?.neighborhoods ?? [],
    listingType: (profile?.listingType as 'RENT' | 'SALE') ?? 'RENT',
    minPrice: profile?.minPrice ?? 0,
    maxPrice: profile?.maxPrice ?? 5000,
    includeCondoInMaxPrice: profile?.includeCondoInMaxPrice ?? true,
    minBedrooms: profile?.minBedrooms ?? 0,
    minBathrooms: profile?.minBathrooms ?? 0,
    minParkingSpots: profile?.minParkingSpots ?? 0,
    minSqm: profile?.minSqm ?? 0,
    petFriendly: profile?.petFriendly ?? false,
    amenities: profile?.amenities ?? [],
  };
}

export default function PreferencesForm({
  profile,
  workspaceName,
  workspaceKind,
  knownNeighborhoods,
}: {
  profile: PreferenceProfile | null;
  workspaceName: string;
  workspaceKind: 'SOLO' | 'PARTY';
  knownNeighborhoods: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initial(profile));
  const [draftHood, setDraftHood] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const toggleList = (key: 'neighborhoods' | 'amenities', value: string) => {
    const current = form[key];
    set(
      key,
      current.some((v) => v.toLowerCase() === value.toLowerCase())
        ? current.filter((v) => v.toLowerCase() !== value.toLowerCase())
        : [...current, value],
    );
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await savePreferences({
        ...form,
        minPrice: form.minPrice || null,
        maxPrice: form.maxPrice || null,
      });
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const numberField = (label: string, key: 'minBedrooms' | 'minBathrooms' | 'minParkingSpots', max = 6) => (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max + 1 }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => set(key, n)}
            className={clsx('tag-toggle !min-w-[3.25rem] !justify-center !px-3', form[key] === n && 'tag-toggle-on')}
          >
            {n === 0 ? 'Any' : `${n}+`}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold">Location</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="city">
              City
            </label>
            <input
              id="city"
              className="input"
              required
              minLength={2}
              placeholder="São Paulo"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </div>

          <div>
            <p className="label">Listing type</p>
            <div className="flex gap-1.5">
              {(['RENT', 'SALE'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('listingType', t)}
                  className={clsx('tag-toggle !min-w-[3.25rem] !justify-center !px-3', form.listingType === t && 'tag-toggle-on')}
                >
                  {t === 'RENT' ? 'Rent' : 'Buy'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="label">Target neighborhoods</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {form.neighborhoods.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => toggleList('neighborhoods', n)}
                className="chip tint-pro"
              >
                {n} <span className="opacity-60">×</span>
              </button>
            ))}
            {form.neighborhoods.length === 0 && (
              <span className="text-xs text-ink-400">Empty = the whole city</span>
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {knownNeighborhoods
              .filter((n) => !form.neighborhoods.some((v) => v.toLowerCase() === n.toLowerCase()))
              .slice(0, 20)
              .map((n) => (
                <button key={n} type="button" onClick={() => toggleList('neighborhoods', n)} className="tag-toggle">
                  + {n}
                </button>
              ))}
          </div>

          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Add a neighborhood…"
              value={draftHood}
              onChange={(e) => setDraftHood(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (draftHood.trim()) toggleList('neighborhoods', draftHood.trim());
                  setDraftHood('');
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              disabled={!draftHood.trim()}
              onClick={() => {
                toggleList('neighborhoods', draftHood.trim());
                setDraftHood('');
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 text-sm font-semibold">Budget</h2>
        <p className="mb-4 text-xs text-ink-500">
          {form.includeCondoInMaxPrice
            ? 'The ceiling is checked against rent + condo fee + taxes — what actually leaves your account.'
            : 'The ceiling is checked against the advertised rent only.'}
        </p>

        <label className="well mb-5 flex cursor-pointer items-start gap-3 p-4">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={form.includeCondoInMaxPrice}
            onChange={(e) => set('includeCondoInMaxPrice', e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Calculate max budget as (Rent + Condo Fee + Taxes)</span>
            <span className="block text-xs text-ink-500">
              Turn off to compare against bare rent, ignoring monthly fees.
            </span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">Minimum</span>
              <span className="tabular-nums text-ink-600">{form.minPrice ? money(form.minPrice) : 'No minimum'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={PRICE_CEILING}
              step={100}
              value={form.minPrice}
              onChange={(e) => set('minPrice', Number(e.target.value))}
            />
          </div>

          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">Maximum</span>
              <span className="tabular-nums text-ink-600">
                {form.maxPrice ? money(form.maxPrice) : 'No maximum'}
                <span className="ml-1 text-xs text-ink-400">
                  {form.includeCondoInMaxPrice ? 'all-in' : 'rent only'}
                </span>
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={PRICE_CEILING}
              step={100}
              value={form.maxPrice}
              onChange={(e) => set('maxPrice', Number(e.target.value))}
            />
          </div>
        </div>

        {form.minPrice > form.maxPrice && form.maxPrice > 0 && (
          <p className="mt-3 text-xs text-amber-700">Minimum is above maximum — they will be swapped on save.</p>
        )}
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold">Property specs</h2>

        <div className="grid gap-5 sm:grid-cols-3">
          {numberField('Bedrooms', 'minBedrooms')}
          {numberField('Bathrooms', 'minBathrooms', 4)}
          {numberField('Parking spots', 'minParkingSpots', 4)}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">Minimum area</span>
            <span className="tabular-nums text-ink-600">{form.minSqm ? `${form.minSqm} m²` : 'Any'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={400}
            step={5}
            value={form.minSqm}
            onChange={(e) => set('minSqm', Number(e.target.value))}
          />
        </div>

        <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="shrink-0"
            checked={form.petFriendly}
            onChange={(e) => set('petFriendly', e.target.checked)}
          />
          Only pet-friendly listings
          <span className="text-xs text-ink-400">(listings with an unknown policy are kept)</span>
        </label>

        <div className="mt-5">
          <p className="label">Amenities</p>
          <div className="flex flex-wrap gap-1.5">
            {AMENITY_OPTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => toggleList('amenities', a)}
                className={clsx('tag-toggle', form.amenities.includes(a) && 'tag-toggle-on')}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-surface/95 p-4 shadow-neu-lg backdrop-blur">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : `Save ${workspaceKind === 'PARTY' ? 'shared' : 'personal'} preferences`}
        </button>
        <span className="text-sm text-ink-500">
          Applies to <strong className="font-bold text-ink-700">{workspaceName}</strong>
          {workspaceKind === 'PARTY' && ' — every member sees this filter'}
        </span>
        {saved && <span className="chip tint-pro ml-auto">Saved ✓</span>}
        {error && <span className="chip tint-con ml-auto">{error}</span>}
      </div>
    </form>
  );
}
