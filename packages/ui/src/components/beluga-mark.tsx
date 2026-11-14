const mark = new URL('../assets/beluga-mark.svg?no-inline', import.meta.url).href;

export function BelugaMark() {
  return (
    <svg aria-hidden="true" className="size-8 shrink-0 text-primary" viewBox="0 0 64 64">
      <use href={`${mark}#beluga-mark`} />
    </svg>
  );
}
