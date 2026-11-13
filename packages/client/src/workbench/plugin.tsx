import type { Plugin } from '@workspace/runtime';
import { createViews } from '@workspace/runtime/react';
import { createDestinations } from './destinations.js';
import { Workbench } from './ui/shell.js';
import './contract.js';

export const workbenchClient: Plugin = {
  id: 'workbench',
  provides: ['views', 'destinations'],
  setup(context) {
    const views = createViews();
    const destinations = createDestinations();
    context.provide('views', views);
    context.provide('destinations', destinations);
    context.onDispose(views.register('main', () => <Workbench destinations={destinations} />));
  },
};
