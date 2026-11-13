import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from '@workspace/ui/components/field';
import { useSyncExternalStore } from 'react';
import type { AgentPresetsClient } from './contract.js';

export function BuiltInTools({ client }: { client: AgentPresetsClient }) {
  const { capabilities } = useSyncExternalStore(client.subscribe, client.getSnapshot);

  return (
    <FieldSet>
      <FieldLegend>Available capabilities</FieldLegend>
      <FieldGroup>
        {capabilities.length ? (
          <ul className="divide-y">
            {capabilities.map(({ id, name, description }) => (
              <li key={id} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <h3 className="text-sm font-medium">{name}</h3>
                <FieldDescription>{description}</FieldDescription>
              </li>
            ))}
          </ul>
        ) : (
          <FieldDescription>This Host has no registered capabilities.</FieldDescription>
        )}
      </FieldGroup>
    </FieldSet>
  );
}
