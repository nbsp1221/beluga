import type { Plugin } from '@workspace/runtime';
import { Bot, Wrench } from 'lucide-react';
import { BuiltInTools } from './built-in-tools.js';
import { AgentPresetEditor } from './editor.js';

export const agentPresetsClient: Plugin = {
  id: 'agent-presets',
  requires: ['destinations', 'agentPresets'],
  setup(context) {
    const client = context.get('agentPresets');
    const destinations = context.get('destinations');
    context.onDispose(
      destinations.registerSetting({
        id: 'built-in-tools',
        label: 'Built-in tools',
        icon: Wrench,
        description:
          'Capabilities available on this Host. Choose which ones an agent can use in Agent presets.',
        component: () => <BuiltInTools client={client} />,
      }),
    );
    context.onDispose(
      destinations.registerSetting({
        id: 'agent-presets',
        label: 'Agent presets',
        icon: Bot,
        description:
          'Combine instructions with capabilities. Saved changes apply to new conversations.',
        component: () => <AgentPresetEditor client={client} />,
      }),
    );
  },
};
