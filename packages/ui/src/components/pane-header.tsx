import type { ComponentProps } from 'react';
import { cn } from 'cn';

export function PaneHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      className={cn('flex min-h-10 shrink-0 items-center gap-2 px-3 py-1', className)}
      {...props}
    />
  );
}
