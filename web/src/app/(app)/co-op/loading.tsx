export default function CoOpLoading() {
  return (
    <div className="space-y-8">
      <div className="skeleton h-9 w-56" />
      <div className="grid gap-5 md:grid-cols-2">
        <div className="skeleton h-36 md:col-span-2" />
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-72 w-[19rem] shrink-0" />
        ))}
      </div>
    </div>
  );
}
