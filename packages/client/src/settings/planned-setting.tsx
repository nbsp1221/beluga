import { Field, FieldContent, FieldDescription, FieldLabel } from '@workspace/ui/components/field';
import { Select, SelectTrigger, SelectValue } from '@workspace/ui/components/select';
import { useId } from 'react';

export function PlannedSetting({ label, description }: { label: string; description: string }) {
  const id = useId();
  return (
    <Field orientation="responsive">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription id={id + '-description'}>{description}</FieldDescription>
      </FieldContent>
      <Select disabled>
        <SelectTrigger id={id} aria-describedby={id + '-description'} className="touch-target">
          <SelectValue>Not available yet</SelectValue>
        </SelectTrigger>
      </Select>
    </Field>
  );
}
