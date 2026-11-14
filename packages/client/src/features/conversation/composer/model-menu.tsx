import type { ModelOption, RunSettings } from '@workspace/protocol/host';
import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { ChevronDown } from 'lucide-react';

export const effortLabels: Record<RunSettings['effort'], string> = {
  default: 'Default',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export function ModelMenu({
  models,
  model,
  effort,
  unavailable,
  disabled,
  onChange,
}: {
  models: readonly ModelOption[];
  model: ModelOption;
  effort: RunSettings['effort'];
  unavailable: boolean;
  disabled: boolean;
  onChange(this: void, settings: RunSettings): void;
}) {
  const groups = new Map<string, ModelOption[]>();
  for (const item of models) {
    const provider = item.id.split('/', 1)[0];
    const group = groups.get(provider);
    if (group) {
      group.push(item);
    } else {
      groups.set(provider, [item]);
    }
  }

  const displayName = unavailable ? 'Choose model' : model.name;
  const showEffort = !unavailable && model.efforts.length > 0;
  const selectionDescription = showEffort ? `${model.name}, ${effortLabels[effort]}` : model.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Model and effort"
        aria-description={unavailable ? undefined : selectionDescription}
        disabled={disabled}
        render={<Button variant="ghost" className="touch-target max-w-48 min-w-0" />}
      >
        <span className="truncate">{displayName}</span>
        {showEffort && <span className="text-muted-foreground">{effortLabels[effort]}</span>}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="w-auto max-w-[calc(100vw-2rem)] min-w-48"
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="touch-target">
            <span className="flex flex-1 items-center justify-between gap-3">
              Model <span className="text-muted-foreground">{displayName}</span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={unavailable ? '' : model.id}
              onValueChange={(id: unknown) => {
                if (typeof id === 'string') {
                  onChange({ model: id, effort: 'default' });
                }
              }}
            >
              {[...groups].map(([provider, items]) => (
                <DropdownMenuGroup key={provider}>
                  <DropdownMenuLabel>{items[0]?.providerName}</DropdownMenuLabel>
                  {items.map((item) => (
                    <DropdownMenuRadioItem
                      key={item.id}
                      value={item.id}
                      closeOnClick
                      className="touch-target"
                    >
                      {item.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {showEffort && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="touch-target">
              <span className="flex flex-1 items-center justify-between gap-3">
                Effort <span className="text-muted-foreground">{effortLabels[effort]}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={effort}
                onValueChange={(value) => {
                  const next = model.efforts.find((option) => option === value);
                  if (next || value === 'default') {
                    onChange({ model: model.id, effort: next ?? 'default' });
                  }
                }}
              >
                {(['default', ...model.efforts] as const).map((item) => (
                  <DropdownMenuRadioItem
                    key={item}
                    value={item}
                    closeOnClick
                    className="touch-target"
                  >
                    {effortLabels[item]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
