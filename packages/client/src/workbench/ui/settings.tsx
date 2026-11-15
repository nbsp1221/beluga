import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@workspace/ui/components/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@workspace/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { useTheme } from '@workspace/ui/components/theme-provider';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { SettingsSection } from '../destinations.js';
import { PlannedSetting } from '../../settings/planned-setting.js';

const themes = { light: 'Light', dark: 'Dark', system: 'System' };

function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const themeId = useId();
  return (
    <div className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend>Appearance</FieldLegend>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor={themeId}>Theme</FieldLabel>
              <FieldDescription>Choose the color theme for this client.</FieldDescription>
            </FieldContent>
            <Select
              value={theme}
              items={themes}
              onValueChange={(value) => {
                if (value === 'light' || value === 'dark' || value === 'system') {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger id={themeId} className="touch-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {Object.entries(themes).map(([value, label]) => (
                    <SelectItem key={value} value={value} className="touch-target">
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <FieldSeparator />
          <PlannedSetting
            label="Language"
            description="Choose the language of the Beluga interface."
          />
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Conversations</FieldLegend>
        <FieldGroup>
          <PlannedSetting
            label="Conversation font size"
            description="Adjust the text size of messages and work details."
          />
          <FieldSeparator />
          <PlannedSetting
            label="Work details"
            description="Choose how much reasoning and tool activity appears in Chat."
          />
          <FieldSeparator />
          <PlannedSetting
            label="Collapse work details"
            description="Choose when the work summary collapses automatically."
          />
          <FieldSeparator />
          <PlannedSetting
            label="Send behavior while busy"
            description="Choose how a new message is handled while the agent is working."
          />
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Agent defaults</FieldLegend>
        <FieldGroup>
          <PlannedSetting
            label="Default permission"
            description="Choose the initial permission for new chats."
          />
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Keyboard</FieldLegend>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>Keyboard shortcuts</FieldTitle>
              <FieldDescription>
                View and customize shortcuts for common actions. Not available yet.
              </FieldDescription>
            </FieldContent>
            <Button variant="outline" disabled className="touch-target">
              Edit shortcuts
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </div>
  );
}

export function Settings({
  sections,
  mobile,
  triggerClassName,
}: {
  sections: readonly SettingsSection[];
  mobile: boolean;
  triggerClassName?: string;
}) {
  const [sectionHistory, setSectionHistory] = useState(['general']);
  const headingId = useId();
  const generalButtonRef = useRef<HTMLButtonElement>(null);
  const general: SettingsSection = {
    id: 'general',
    label: 'General',
    icon: SettingsIcon,
    component: GeneralSettings,
  };
  const entries = [general, ...sections];
  const active = entries.find(({ id }) => id === sectionHistory.at(-1)) ?? general;
  // Keep previously opened sections mounted while switching within the dialog.
  const mountedSections = entries.filter(
    (entry) => entry.id === active.id || sectionHistory.includes(entry.id),
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setSectionHistory(['general']);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Settings"
            className={triggerClassName}
          />
        }
      >
        <SettingsIcon className="size-5" />
        {mobile && <span>Settings</span>}
      </DialogTrigger>
      <DialogContent
        initialFocus={generalButtonRef}
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden p-0 max-md:inset-0 max-md:h-dvh max-md:max-w-none max-md:translate-none max-md:rounded-none md:h-[min(800px,calc(100dvh-2rem))] md:max-w-[min(800px,calc(100%-2rem))]"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage Beluga preferences and features.
          </DialogDescription>
          <DialogClose render={<ShellButton size="icon" label="Close settings" />}>
            <X />
          </DialogClose>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 md:w-48 md:flex-col md:overflow-y-auto md:border-b-0 md:py-6"
          >
            {entries.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                ref={id === 'general' ? generalButtonRef : undefined}
                variant={id === active.id ? 'secondary' : 'ghost'}
                size="lg"
                aria-current={id === active.id ? true : undefined}
                className="touch-target shrink-0 justify-start"
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                }
                onClick={() => {
                  if (id !== active.id) {
                    setSectionHistory((current) => [...current.filter((item) => item !== id), id]);
                  }
                }}
              >
                <Icon data-icon="inline-start" aria-hidden />
                {label}
              </Button>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 scrollbar-gutter-stable overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
            {mountedSections.map((entry) => (
              <div key={entry.id} hidden={entry.id !== active.id}>
                <section
                  aria-labelledby={headingId + entry.id}
                  className="flex min-w-0 flex-col gap-5"
                >
                  <div className="flex flex-col gap-1">
                    <h2 id={headingId + entry.id} className="text-base font-semibold">
                      {entry.label}
                    </h2>
                    {entry.description && (
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                    )}
                  </div>
                  <entry.component />
                </section>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
