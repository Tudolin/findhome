'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { PreferenceProfile } from '@prisma/client';
import { AMENITY_OPTIONS } from '@/lib/constants';
import { BR_STATES, displayName, locationSlug } from '@/lib/locations';
import { savePreferences } from '@/lib/client';
import { money } from '@/lib/format';
import { useT } from './LocaleProvider';

type FormState = {
  city: string;
  state: string;
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
  alertsEnabled: boolean;
  alertWhatsapp: string;
  alertMaxPerRun: number;
};

const PRICE_CEILING = 20000;

function initial(profile: PreferenceProfile | null): FormState {
  return {
    city: profile?.city ?? '',
    state: profile?.state ?? '',
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
    alertsEnabled: profile?.alertsEnabled ?? false,
    alertWhatsapp: profile?.alertWhatsapp ?? '',
    alertMaxPerRun: profile?.alertMaxPerRun ?? 5,
  };
}

/** Digits only, 10–15 of them: the shortest and longest plausible E.164 number. */
const phoneLooksComplete = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
};

export default function PreferencesForm({
  profile,
  workspaceName,
  workspaceKind,
  knownNeighborhoods,
  whatsappConfigured,
}: {
  profile: PreferenceProfile | null;
  workspaceName: string;
  workspaceKind: 'SOLO' | 'PARTY';
  knownNeighborhoods: string[];
  /** Whether the SERVER has a WhatsApp provider set up. Purely informational. */
  whatsappConfigured: boolean;
}) {
  const t = useT();
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

  /** Slugs already chosen, so suggestions and duplicates agree with the server. */
  const chosenSlugs = useMemo(() => new Set(form.neighborhoods.map(locationSlug)), [form.neighborhoods]);

  /**
   * Add/remove by slug rather than by string. Typing "vila mariana" when
   * "Vila Mariana" is already a chip removes it instead of adding a second one —
   * the same rule the API applies on save (see dedupeBySlug).
   */
  const toggleNeighborhood = (value: string) => {
    const display = displayName(value, 80);
    const slug = locationSlug(display);
    if (!slug) return;

    set(
      'neighborhoods',
      chosenSlugs.has(slug)
        ? form.neighborhoods.filter((n) => locationSlug(n) !== slug)
        : [...form.neighborhoods, display],
    );
  };

  const toggleAmenity = (value: string) => {
    set(
      'amenities',
      form.amenities.includes(value) ? form.amenities.filter((v) => v !== value) : [...form.amenities, value],
    );
  };

  const commitDraft = () => {
    if (!draftHood.trim()) return;
    toggleNeighborhood(draftHood);
    setDraftHood('');
  };

  const phoneInvalid = form.alertsEnabled && form.alertWhatsapp.trim() !== '' && !phoneLooksComplete(form.alertWhatsapp);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await savePreferences({
        ...form,
        state: form.state || null,
        minPrice: form.minPrice || null,
        maxPrice: form.maxPrice || null,
        alertWhatsapp: form.alertWhatsapp.trim() || null,
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
            {n === 0 ? t.filters.any : `${n}+`}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold">{t.preferences.location}</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="city">
              {t.preferences.city}
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
            <p className="mt-1 text-[11px] text-ink-400">{t.preferences.cityHint}</p>
          </div>

          <div>
            <label className="label" htmlFor="state">
              {t.preferences.state}
            </label>
            <select id="state" className="input" value={form.state} onChange={(e) => set('state', e.target.value)}>
              <option value="">{t.preferences.anyState}</option>
              {BR_STATES.map((s) => (
                <option key={s.uf} value={s.uf}>
                  {s.uf} · {s.name}
                </option>
              ))}
            </select>
            {!form.state && <p className="mt-1 text-[11px] text-warning">{t.preferences.stateWarning}</p>}
          </div>
        </div>

        <div className="mt-4">
          <p className="label">{t.preferences.listingType}</p>
          <div className="flex gap-1.5">
            {(['RENT', 'SALE'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set('listingType', type)}
                className={clsx(
                  'tag-toggle !min-w-[3.25rem] !justify-center !px-3',
                  form.listingType === type && 'tag-toggle-on',
                )}
              >
                {type === 'RENT' ? t.preferences.rent : t.preferences.buy}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="label">{t.preferences.neighborhoods}</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {form.neighborhoods.map((n) => (
              <button
                key={locationSlug(n)}
                type="button"
                onClick={() => toggleNeighborhood(n)}
                className="chip tint-pro"
              >
                {n} <span className="opacity-60">×</span>
              </button>
            ))}
            {form.neighborhoods.length === 0 && (
              <span className="text-xs text-ink-400">{t.preferences.wholeCity}</span>
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {knownNeighborhoods
              .filter((n) => !chosenSlugs.has(locationSlug(n)))
              .slice(0, 20)
              .map((n) => (
                <button
                  key={locationSlug(n)}
                  type="button"
                  onClick={() => toggleNeighborhood(n)}
                  className="tag-toggle"
                >
                  + {n}
                </button>
              ))}
          </div>

          <div className="flex gap-2">
            <input
              className="input"
              placeholder={t.preferences.addNeighborhood}
              value={draftHood}
              onChange={(e) => setDraftHood(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                }
              }}
            />
            <button type="button" className="btn-ghost" disabled={!draftHood.trim()} onClick={commitDraft}>
              {t.preferences.add}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 text-sm font-semibold">{t.preferences.budget}</h2>
        <p className="mb-4 text-xs text-ink-500">
          {form.includeCondoInMaxPrice ? t.preferences.budgetAllIn : t.preferences.budgetRentOnly}
        </p>

        <label className="well mb-5 flex cursor-pointer items-start gap-3 p-4">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={form.includeCondoInMaxPrice}
            onChange={(e) => set('includeCondoInMaxPrice', e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">{t.preferences.includeCondo}</span>
            <span className="block text-xs text-ink-500">{t.preferences.includeCondoHint}</span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">{t.preferences.minimum}</span>
              <span className="tabular-nums text-ink-600">
                {form.minPrice ? money(form.minPrice) : t.preferences.noMinimum}
              </span>
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
              <span className="font-medium">{t.preferences.maximum}</span>
              <span className="tabular-nums text-ink-600">
                {form.maxPrice ? money(form.maxPrice) : t.preferences.noMaximum}
                <span className="ml-1 text-xs text-ink-400">
                  {form.includeCondoInMaxPrice ? t.preferences.allIn : t.preferences.rentOnly}
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
          <p className="mt-3 text-xs text-warning">{t.preferences.swapWarning}</p>
        )}
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold">{t.preferences.specs}</h2>

        <div className="grid gap-5 sm:grid-cols-3">
          {numberField(t.preferences.bedrooms, 'minBedrooms')}
          {numberField(t.preferences.bathrooms, 'minBathrooms', 4)}
          {numberField(t.preferences.parking, 'minParkingSpots', 4)}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">{t.preferences.minArea}</span>
            <span className="tabular-nums text-ink-600">{form.minSqm ? `${form.minSqm} m²` : t.filters.any}</span>
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
          {t.preferences.petsOnly}
          <span className="text-xs text-ink-400">{t.preferences.petsHint}</span>
        </label>

        <div className="mt-5">
          <p className="label">{t.preferences.amenities}</p>
          <div className="flex flex-wrap gap-1.5">
            {AMENITY_OPTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => toggleAmenity(a)}
                className={clsx('tag-toggle', form.amenities.includes(a) && 'tag-toggle-on')}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 text-sm font-semibold">{t.alerts.title}</h2>
        <p className="mb-4 text-xs text-ink-500">{t.alerts.subtitle}</p>

        {!whatsappConfigured && <p className="well-sm mb-4 px-4 py-3 text-xs text-warning">{t.alerts.notConfigured}</p>}

        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="shrink-0"
            checked={form.alertsEnabled}
            onChange={(e) => set('alertsEnabled', e.target.checked)}
          />
          {t.alerts.enable}
        </label>

        {form.alertsEnabled && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="alertWhatsapp">
                {t.alerts.phone}
              </label>
              <input
                id="alertWhatsapp"
                className="input"
                inputMode="numeric"
                placeholder="5541999998888"
                value={form.alertWhatsapp}
                onChange={(e) => set('alertWhatsapp', e.target.value)}
              />
              <p className={clsx('mt-1 text-[11px]', phoneInvalid ? 'text-warning' : 'text-ink-400')}>
                {phoneInvalid ? t.alerts.phoneInvalid : t.alerts.phoneHint}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="alertMaxPerRun">
                {t.alerts.maxPerRun}
              </label>
              <select
                id="alertMaxPerRun"
                className="input"
                value={form.alertMaxPerRun}
                onChange={(e) => set('alertMaxPerRun', Number(e.target.value))}
              >
                {[1, 3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">{t.alerts.maxPerRunHint}</p>
            </div>

            <p className="text-[11px] text-ink-500 sm:col-span-2">{t.alerts.firstRunNote}</p>
          </div>
        )}
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-surface/95 p-4 shadow-neu-lg backdrop-blur">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t.preferences.saving : t.preferences.save(workspaceKind === 'PARTY')}
        </button>
        <span className="text-sm text-ink-500">
          {t.preferences.appliesTo} <strong className="font-bold text-ink-700">{workspaceName}</strong>
          {workspaceKind === 'PARTY' && t.preferences.everyMember}
        </span>
        {saved && <span className="chip tint-pro ml-auto">{t.preferences.saved}</span>}
        {error && <span className="chip tint-con ml-auto">{error}</span>}
      </div>
    </form>
  );
}
