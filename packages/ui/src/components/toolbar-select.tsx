import type { ReactNode, Ref } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectValue } from './select';

// Select owns value/keyboard behavior; the official ghost Button owns appearance.
export function ToolbarSelect({
  label,
  value,
  options,
  getLabel = (value) => value,
  getDescription,
  renderOption,
  renderValue,
  isOptionDisabled,
  disabled,
  triggerRef,
  open,
  onOpenChange,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  options: readonly string[];
  getLabel?: (value: string) => string;
  getDescription?: (value: string) => string | undefined;
  renderOption?: (value: string) => ReactNode;
  renderValue?: (value: string) => ReactNode;
  isOptionDisabled?: (value: string) => boolean;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (value: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      itemToStringLabel={getLabel}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      <SelectPrimitive.Trigger
        ref={triggerRef}
        aria-label={label}
        render={
          <Button
            variant="ghost"
            size="default"
            className={cn('touch-target min-w-0 shrink', className)}
          />
        }
      >
        {children}
        <SelectValue className="min-w-0">
          <span className="truncate">{renderValue?.(value) ?? getLabel(value)}</span>
        </SelectValue>
        <SelectPrimitive.Icon render={<ChevronDown />} />
      </SelectPrimitive.Trigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto max-w-[calc(100vw-2rem)] min-w-48"
      >
        <SelectGroup>
          {options.map((option) => {
            const description = getDescription?.(option);
            return (
              <SelectItem
                key={option}
                value={option}
                disabled={isOptionDisabled?.(option)}
                className="touch-target"
              >
                {renderOption ? (
                  renderOption(option)
                ) : (
                  <span className="flex max-w-[calc(100vw-6rem)] flex-col break-words whitespace-normal">
                    <span>{getLabel(option)}</span>
                    {description && (
                      <span className="text-xs text-muted-foreground">{description}</span>
                    )}
                  </span>
                )}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
