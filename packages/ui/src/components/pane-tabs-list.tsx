import type { ComponentProps } from 'react';
import { cn } from 'cn';
import { TabsList } from './tabs';

export function PaneTabsList({
  railClassName,
  className,
  ...props
}: Omit<ComponentProps<typeof TabsList>, 'variant'> & {
  railClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 shrink-0 scrollbar-none overflow-x-auto overflow-y-hidden overscroll-x-contain pb-px',
        railClassName,
      )}
      onFocus={({ currentTarget: rail, target: tab }) => {
        if (tab.getAttribute('role') !== 'tab') {
          return;
        }

        const { left, right } = tab.getBoundingClientRect();
        const railLeft = rail.getBoundingClientRect().left;
        const railRight = railLeft + rail.clientWidth;

        if (left < railLeft) {
          rail.scrollLeft += left - railLeft;
        } else if (right > railRight) {
          rail.scrollLeft += right - railRight;
        }
      }}
    >
      <TabsList variant="line" className={cn('shrink-0 max-md:min-h-13', className)} {...props} />
    </div>
  );
}
