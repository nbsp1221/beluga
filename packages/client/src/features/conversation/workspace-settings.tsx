import { FieldGroup, FieldLegend, FieldSet } from '@workspace/ui/components/field';
import { PlannedSetting } from '../../settings/planned-setting.js';

export function WorkspaceSettings() {
  return (
    <FieldSet>
      <FieldLegend>Git worktrees</FieldLegend>
      <FieldGroup>
        <PlannedSetting
          label="Default workspace location"
          description="Choose whether new chats in Git projects start in the current checkout or a separate worktree."
        />
      </FieldGroup>
    </FieldSet>
  );
}
