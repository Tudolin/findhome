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
  commuteAddress: string;
  commuteMode: 'driving' | 'cycling' | 'walking';
  maxCommuteMin: number;
  alertsEnabled: boolean;
  alertWhatsapp: string;
  alertMaxPerRun: number;
};

/**
 * Budget controls, per listing type.
 *
 * A single rent-shaped slider is what made Buy mode unusable: it topped out at
 * R$ 20.000 in R$ 100 steps, so a purchase budget could not be expressed at all —
 * and a profile switched to Buy silently kept a rent ceiling that then matched no
 * listing in the country. Buy gets a range that reaches R$ 3.000.000 in
 * R$ 10.000 steps, and both modes get a text box so an exact figure can just be
 * typed.
 */
const BUDGET: Record<'RENT' | 'SALE', { ceiling: number; step: number; presets: number[]; defaultMax: number }> = {
  RENT: {
    ceiling: 20_000,
    step: 100,
    presets: [1500, 2000, 2500, 3000, 4000, 5000, 7000, 10_000],
    defaultMax: 5000,
  },
  SALE: {
    ceiling: 3_000_000,
    step: 10_000,
    presets: [200_000, 350_000, 500_000, 650_000, 800_000, 1_000_000, 1_500_000, 2_000_000],
    defaultMax: 600_000,
  },
};

function initial(profile: PreferenceProfile | null): FormState {
  const listingType = (profile?.listingType as 'RENT' | 'SALE') ?? 'RENT';
  return {
    city: profile?.city ?? '',
    state: profile?.state ?? '',
    neighborhoods: profile?.neighborhoods ?? [],
    listingType,
    minPrice: profile?.minPrice ?? 0,
    maxPrice: profile?.maxPrice ?? BUDGET[listingType].defaultMax,
    includeCondoInMaxPrice: profile?.includeCondoInMaxPrice ?? true,
    minBedrooms: profile?.minBedrooms ?? 0,
    minBathrooms: profile?.minBathrooms ?? 0,
    minParkingSpots: profile?.minParkingSpots ?? 0,
    minSqm: profile?.minSqm ?? 0,
    petFriendly: profile?.petFriendly ?? false,
    amenities: profile?.amenities ?? [],
    commuteAddress: profile?.commuteAddress ?? '',
    commuteMode: (profile?.commuteMode as FormState['commuteMode']) ?? 'driving',
    maxCommuteMin: profile?.maxCommuteMin ?? 0,
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

  const budget = BUDGET[form.listingType];
  const forSale = form.listingType === 'SALE';

  /**
   * Switching rent <-> buy has to move the budget with it.
   *
   * Leaving it alone is what made Buy look broken: the profile kept a R$ 5.000
   * ceiling, which as a purchase price matches nothing anywhere, and the feed
   * came back empty with no hint as to why. A budget that is out of range for the
   * new mode is replaced by that mode's default; one that already makes sense
   * (someone typed R$ 700.000 and then toggled twice) is left alone.
   */
  function switchListingType(type: 'RENT' | 'SALE') {
    if (type === form.listingType) return;
    const next = BUDGET[type];
    const plausible = form.maxPrice > 0 && form.maxPrice <= next.ceiling && form.maxPrice >= next.presets[0] / 4;

    setForm((f) => ({
      ...f,
      listingType: type,
      maxPrice: plausible ? f.maxPrice : next.defaultMax,
      minPrice: plausible ? f.minPrice : 0,
      // "Include the condo fee in the ceiling" is a rent-only idea — there is
      // nothing to include in an asking price.
      includeCondoInMaxPrice: type === 'RENT' ? f.includeCondoInMaxPrice : false,
    }));
    setSaved(false);
  }

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
        commuteAddress: form.commuteAddress.trim() || null,
        // 0 in the select means "do not filter on it"; the column is nullable.
        maxCommuteMin: form.maxCommuteMin || null,
      });
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * A budget bound: slider for coarse movement, number box for the exact figure.
   *
   * The box is not a nicety. The slider's range is the listing type's whole
   * plausible span, so on Buy one pixel is worth several thousand reais and
   * "R$ 640.000" is not reachable by dragging. Typing it is.
   */
  const budgetField = (key: 'minPrice' | 'maxPrice', label: string, emptyLabel: string, suffix?: string) => (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-ink-600">
          {form[key] ? money(form[key]) : emptyLabel}
          {suffix && <span className="ml-1 text-xs text-ink-400">{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={budget.ceiling}
        step={budget.step}
        value={Math.min(form[key], budget.ceiling)}
        onChange={(e) => set(key, Number(e.target.value))}
      />
      <input
        type="number"
        className="input mt-2 !py-1.5 text-sm"
        min={0}
        step={budget.step}
        inputMode="numeric"
        placeholder={emptyLabel}
        aria-label={label}
        value={form[key] || ''}
        onChange={(e) => set(key, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </div>
  );

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
                onClick={() => switchListingType(type)}
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
        <h2 className="mb-1 text-sm font-semibold">
          {forSale ? t.preferences.budgetSale : t.preferences.budget}
        </h2>
        <p className="mb-4 text-xs text-ink-500">
          {forSale
            ? t.preferences.budgetSaleHint
            : form.includeCondoInMaxPrice
              ? t.preferences.budgetAllIn
              : t.preferences.budgetRentOnly}
        </p>

        {/* Rent only: an asking price has no monthly fees to fold in. */}
        {!forSale && (
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
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {budgetField('minPrice', t.preferences.minimum, t.preferences.noMinimum)}
          {budgetField(
            'maxPrice',
            t.preferences.maximum,
            t.preferences.noMaximum,
            forSale ? undefined : form.includeCondoInMaxPrice ? t.preferences.allIn : t.preferences.rentOnly,
          )}
        </div>

        {/* One tap for the common budgets. The slider alone is fine for rent and
            hopeless for a purchase: at R$ 10.000 a step, hitting R$ 640.000 on a
            3-million-wide track is not something a mouse can do. */}
        <div className="mt-4">
          <p className="label">{t.preferences.quickCeilings}</p>
          <div className="flex flex-wrap gap-1.5">
            {budget.presets.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => set('maxPrice', value)}
                className={clsx('tag-toggle', form.maxPrice === value && 'tag-toggle-on')}
              >
                {money(value)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => set('maxPrice', 0)}
              className={clsx('tag-toggle', form.maxPrice === 0 && 'tag-toggle-on')}
            >
              {t.preferences.noMaximum}
            </button>
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

      {/* The filter that actually decides where people live, and the one no
          portal offers. Off unless an address is entered — routing needs a
          provider, and an empty box is how you say "I don't care". */}
      <div className="card p-6">
        <h2 className="mb-1 text-sm font-semibold">{t.preferences.commute}</h2>
        <p className="mb-4 text-xs text-ink-500">{t.preferences.commuteHint}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="commuteAddress">
              {t.preferences.commuteAddress}
            </label>
            <input
              id="commuteAddress"
              className="input"
              placeholder="Av. Paulista 1000, São Paulo"
              value={form.commuteAddress}
              onChange={(e) => set('commuteAddress', e.target.value)}
            />
            <p className="mt-1 text-[11px] text-ink-400">{t.preferences.commuteAddressHint}</p>
          </div>

          <div>
            <label className="label" htmlFor="commuteMode">
              {t.preferences.commuteMode}
            </label>
            <select
              id="commuteMode"
              className="input"
              value={form.commuteMode}
              onChange={(e) => set('commuteMode', e.target.value as FormState['commuteMode'])}
            >
              <option value="driving">{t.preferences.driving}</option>
              <option value="cycling">{t.preferences.cycling}</option>
              <option value="walking">{t.preferences.walking}</option>
            </select>
          </div>
        </div>

        {form.commuteAddress.trim() && (
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">{t.preferences.maxCommute}</span>
              <span className="tabular-nums text-ink-600">
                {form.maxCommuteMin ? `${form.maxCommuteMin} min` : t.filters.any}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={form.maxCommuteMin}
              onChange={(e) => set('maxCommuteMin', Number(e.target.value))}
            />
          </div>
        )}
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
