import type { Plugin } from '@workspace/runtime';
import { Database } from 'lucide-react';
import { ProviderSettings } from './settings.js';

export const modelProvidersClient: Plugin = {
  id: 'model-providers',
  requires: ['destinations', 'modelProviders'],
  setup(context) {
    const client = context.get('modelProviders');
    context.onDispose(
      context.get('destinations').registerSetting({
        id: 'providers',
        label: 'Providers',
        icon: Database,
        description: 'Connect a provider to use its models in chat.',
        component: () => <ProviderSettings client={client} />,
      }),
    );
  },
};
