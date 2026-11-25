import { expect, test } from 'vitest';
import { resolveLayout } from '../src/workbench/ui/columns.js';

const panelModes = [
  // Width, overlay with the sidebar open, overlay with the sidebar collapsed.
  [268, true, true],
  [323, true, true],
  [588, true, true],
  [716, false, false],
  [768, true, false],
  [972, true, false],
  [1024, false, false],
  [1228, false, false],
  [1868, false, false],
] as const;

test.for(
  panelModes.flatMap(([width, openOverlay, collapsedOverlay]) => [
    { width, sidebar: 'open', overlay: openOverlay },
    { width, sidebar: 'collapsed', overlay: collapsedOverlay },
  ]),
)(
  'uses the expected context panel mode at $width px with the sidebar $sidebar',
  ({ width, sidebar, overlay }) => {
    const layout = resolveLayout(width, sidebar === 'collapsed', 280, true);
    expect(layout.panelOverlay).toBe(overlay);
    expect(layout.panel === 0).toBe(overlay);
    expect(layout.panel).toBeGreaterThanOrEqual(overlay ? 0 : 300);
    expect(width - layout.sidebar - layout.panel).toBeGreaterThanOrEqual(overlay ? 0 : 400);
  },
);

test.for([
  { requested: 999, collapsed: false, expected: 420 },
  { requested: 1, collapsed: false, expected: 264 },
  { requested: 280, collapsed: true, expected: 0 },
])(
  'uses a sidebar width of $expected for a $requested px request with collapsed=$collapsed',
  ({ requested, collapsed, expected }) => {
    expect(resolveLayout(1228, collapsed, requested, false).sidebar).toBe(expected);
  },
);
