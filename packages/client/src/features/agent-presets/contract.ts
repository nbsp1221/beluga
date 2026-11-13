import '@workspace/runtime';
import type { AgentPreset, AgentPresetInput, AgentPresets } from '@workspace/protocol/host';
import type { ReadStore } from '../../state/store.js';

export interface AgentPresetsClient extends ReadStore<AgentPresets> {
  refresh(this: void): Promise<void>;
  save(definition: AgentPresetInput, previous?: AgentPreset): Promise<AgentPreset>;
}

declare module '@workspace/runtime' {
  interface Services {
    agentPresets: AgentPresetsClient;
  }
}
