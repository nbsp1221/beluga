import type { ComponentProps } from 'react';
import { cn } from 'cn';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export function ShellButton({
  label,
  children,
  size = 'icon-sm',
  variant = 'ghost',
  hintSide,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  hintSide?: 'right' | 'top' | 'bottom' | 'left';
}) {
  const button = (
    <Button
      {...props}
      className={cn('touch-target', className)}
      variant={variant}
      size={size}
      aria-label={label}
    >
      {children}
    </Button>
  );

  if (!hintSide) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={hintSide}>{label}</TooltipContent>
    </Tooltip>
  );
}
