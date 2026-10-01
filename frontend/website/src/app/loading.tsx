/**
 * Route skeleton, shown while the next page's content is on its way during
 * navigation. Mirrors the shape every page opens with: eyebrow, headline,
 * lead paragraph, buttons, a framed screenshot, then a row of cards.
 */
export default function Loading() {
  const bar = "skeleton skeleton-block";
  return (
    <div aria-busy="true" aria-label="Loading page" className="mx-auto max-w-6xl px-4 pb-24 pt-32 md:px-6 md:pt-40">
      <div className={`${bar} h-3 w-28`} />
      <div className={`${bar} mt-6 h-12 w-full max-w-2xl md:h-16`} />
      <div className={`${bar} mt-3 h-12 w-2/3 max-w-xl md:h-16`} />
      <div className={`${bar} mt-8 h-4 w-full max-w-lg`} />
      <div className={`${bar} mt-3 h-4 w-5/6 max-w-md`} />
      <div className="mt-9 flex gap-3">
        <div className={`${bar} h-12 w-36 !rounded-full`} />
        <div className={`${bar} h-12 w-36 !rounded-full`} />
      </div>
      <div className={`${bar} mt-14 aspect-[16/10] w-full !rounded-[18px]`} />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${bar} h-40 !rounded-[20px]`} />
        ))}
      </div>
    </div>
  );
}
