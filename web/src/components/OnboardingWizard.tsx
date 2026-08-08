'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { BR_STATES, locationSlug } from '@/lib/locations';
import { money } from '@/lib/format';
import { savePreferences } from '@/lib/client';
import { useT } from './LocaleProvider';

/**
 * The three questions the app cannot work without.
 *
 * Deliberately three, and deliberately not the Preferences screen. That screen
 * has eleven sections and is the right place to *tune* a search; it is the wrong
 * place to *start* one, because someone who has never used the app cannot tell
 * which of the eleven matter. Everything skipped here has a sensible default and
 * can be set later.
 *
 * The state question is not padding. Every portal scopes its search by UF, and a
 * city without one returns another state's listings — so it is the one field
 * whose absence produces confidently wrong results rather than merely broad ones.
 */

const RENT_STEPS = [1500, 2000, 2500, 3000, 4000, 5000, 7000, 10_000];
const SALE_STEPS = [250_000, 350_000, 500_000, 650_000, 800_000, 1_000_000, 1_500_000];

export default function OnboardingWizard({
  workspaceName,
  isParty,
  greeting,
}: {
  workspaceName: string;
  isParty: boolean;
  greeting: string;
}) {
  const t = useT();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [listingType, setListingType] = useState<'RENT' | 'SALE'>('RENT');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [maxPrice, setMaxPrice] = useState(0);
  const [minBedrooms, setMinBedrooms] = useState(0);

  const forSale = listingType === 'SALE';
  const steps = forSale ? SALE_STEPS : RENT_STEPS;

  /** Only the city is genuinely required; the rest has usable defaults. */
  const canFinish = city.trim().length >= 2;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences({
        city: city.trim(),
        state: state || null,
        neighborhoods: [],
        listingType,
        // Written into the pair that matches the mode. The other stays null, so
        // switching later finds an empty budget rather than a nonsense one.
        minPrice: null,
        maxPrice: forSale ? null : maxPrice || null,
        saleMinPrice: null,
        saleMaxPrice: forSale ? maxPrice || null : null,
        includeCondoInMaxPrice: !forSale,
        minBedrooms,
        minBathrooms: 0,
        minParkingSpots: 0,
        minSqm: 0,
        petFriendly: false,
        amenities: [],
        commuteAddress: null,
        commuteMode: 'driving',
        maxCommuteMin: null,
        alertsEnabled: false,
        alertWhatsapp: null,
        alertMaxPerRun: 5,
      });
      // Full navigation, not router.push: the layout's "no profile → /onboarding"
      // redirect has to be re-evaluated on the server, and a soft navigation
      // would bounce straight back here from the client cache.
      window.location.href = '/dashboard?welcome=1';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const dot = (index: number) => (
    <span
      key={index}
      className={clsx(
        'h-1.5 rounded-full transition-all duration-200',
        index === step ? 'w-6 bg-brand-500' : index < step ? 'w-1.5 bg-brand-300' : 'w-1.5 bg-ink-300/50',
      )}
    />
  );

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center py-6">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-black tracking-tight text-ink-900">{greeting}</h1>
        <p className="mt-2 text-sm text-ink-500">
          {isParty ? t.onboarding.subtitleParty(workspaceName) : t.onboarding.subtitle}
        </p>
      </div>

      <div className="mb-5 flex justify-center gap-1.5">{[0, 1, 2].map(dot)}</div>

      <div className="card card-p">
        {/* --- 1. Rent or buy ------------------------------------------- */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-ink-800">{t.onboarding.q1}</h2>
              <p className="mt-1 text-xs text-ink-500">{t.onboarding.q1Hint}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(['RENT', 'SALE'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setListingType(type)}
                  className={clsx(
                    'rounded-2xl px-4 py-6 text-center transition-all duration-150 ease-neu',
                    listingType === type ? 'pressed-on' : 'pressed-off',
                  )}
                >
                  <span aria-hidden className="block text-2xl">
                    {type === 'RENT' ? '🔑' : '🏡'}
                  </span>
                  <span className="mt-2 block text-sm font-bold">
                    {type === 'RENT' ? t.preferences.rent : t.preferences.buy}
                  </span>
                </button>
              ))}
            </div>

            <button type="button" className="btn-primary w-full !py-3" onClick={() => setStep(1)}>
              {t.onboarding.next}
            </button>
          </div>
        )}

        {/* --- 2. Where ------------------------------------------------- */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-ink-800">{t.onboarding.q2}</h2>
              <p className="mt-1 text-xs text-ink-500">{t.onboarding.q2Hint}</p>
            </div>

            <div>
              <label className="label" htmlFor="ob-city">
                {t.preferences.city}
              </label>
              <input
                id="ob-city"
                className="input"
                placeholder="Curitiba"
                value={city}
                autoFocus
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="ob-state">
                {t.preferences.state}
              </label>
              <select id="ob-state" className="input" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">{t.preferences.anyState}</option>
                {BR_STATES.map((uf) => (
                  <option key={uf.uf} value={uf.uf}>
                    {uf.uf} — {uf.name}
                  </option>
                ))}
              </select>
              {/* Not a nag: without a UF the portals return another state's
                  listings, which looks like the app is broken rather than broad. */}
              {!state && <p className="mt-1.5 text-xs text-warning">{t.preferences.stateWarning}</p>}
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setStep(0)}>
                {t.onboarding.back}
              </button>
              <button
                type="button"
                className="btn-primary flex-1 !py-3"
                disabled={locationSlug(city).length < 2}
                onClick={() => setStep(2)}
              >
                {t.onboarding.next}
              </button>
            </div>
          </div>
        )}

        {/* --- 3. Budget and size --------------------------------------- */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-ink-800">{t.onboarding.q3}</h2>
              <p className="mt-1 text-xs text-ink-500">
                {forSale ? t.onboarding.q3HintSale : t.onboarding.q3HintRent}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {steps.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMaxPrice(value)}
                  className={clsx('tag-toggle', maxPrice === value && 'tag-toggle-on')}
                >
                  {money(value)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMaxPrice(0)}
                className={clsx('tag-toggle', maxPrice === 0 && 'tag-toggle-on')}
              >
                {t.preferences.noMaximum}
              </button>
            </div>

            <div>
              <p className="label">{t.preferences.bedrooms}</p>
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMinBedrooms(n)}
                    className={clsx('tag-toggle', minBedrooms === n && 'tag-toggle-on')}
                  >
                    {n === 0 ? t.filters.any : `${n}+`}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="well-sm px-4 py-3 text-sm font-medium text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                {t.onboarding.back}
              </button>
              <button
                type="button"
                className="btn-primary flex-1 !py-3"
                disabled={busy || !canFinish}
                onClick={finish}
              >
                {busy ? t.preferences.saving : t.onboarding.finish}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-ink-400">{t.onboarding.footnote}</p>
    </div>
  );
}
