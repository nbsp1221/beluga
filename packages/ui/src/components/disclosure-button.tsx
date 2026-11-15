import type { ComponentProps } from 'react';
import { cn } from 'cn';
import { Button } from './button';

// Expansion is not selection. Keep the official hover and keyboard feedback.
export function DisclosureButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      {...props}
      className={cn(
        'touch-target w-full justify-start aria-expanded:not-hover:bg-transparent',
        className,
      )}
    />
  );
}
