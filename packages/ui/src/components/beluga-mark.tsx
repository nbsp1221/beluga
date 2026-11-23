import { cn } from 'cn';

const mark = new URL('../assets/beluga-mark.svg?no-inline', import.meta.url).href;

export function BelugaMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-8 shrink-0 text-primary', className)}
      viewBox="0 0 64 64"
    >
      <use href={`${mark}#beluga-mark`} />
    </svg>
  );
}
