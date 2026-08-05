import Link from 'next/link';
import PropertyMap, { type MapPin } from '@/components/PropertyMap';
import { getDictionary } from '@/lib/i18n/server';
import { getMapPins } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Map · FindHome' };

export default async function MapPage() {
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);
  const { pins, withoutCoords } = await getMapPins(ws);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.map.title}</h1>
          <p className="mt-2 text-sm text-ink-500">{t.map.subtitle}</p>
        </div>
        <Link href="/dashboard" className="btn-ghost">
          {t.map.openList}
        </Link>
      </div>

      <PropertyMap pins={pins as MapPin[]} withoutCoords={withoutCoords} />

      {withoutCoords > 0 && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-ink-400">{t.map.missingHelp}</p>
      )}
    </>
  );
}
