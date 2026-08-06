/** Streamed while the review queries run — keeps the neumorphic rhythm in place. */
export default function MyHomesLoading() {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="skeleton h-8 w-56" />
          <div className="skeleton mt-3 h-4 w-96" />
        </div>
        <div className="skeleton h-10 w-40" />
      </div>

      {/* Stat strip, tab strip, toolbar. */}
      <div className="skeleton mb-6 h-[92px]" />
      <div className="skeleton mb-5 h-11 w-full max-w-2xl" />
      <div className="skeleton mb-6 h-[74px]" />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card overflow-hidden p-3">
            <div className="skeleton aspect-[4/3] w-full" />
            <div className="space-y-3 p-2 pt-4">
              <div className="skeleton h-4 w-5/6" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton h-6 w-2/3" />
              <div className="skeleton h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
