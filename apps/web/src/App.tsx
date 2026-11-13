import { Slot, type ViewRegistry } from '@workspace/runtime/react';

export function App({ views }: { views: ViewRegistry }) {
  return <Slot views={views} name="main" />;
}
