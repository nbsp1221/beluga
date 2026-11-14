export const artifactIgnores = [
  '**/dist/**',
  '**/dist-ssr/**',
  '**/coverage/**',
  '**/.turbo/**',
  '.local/**',
];

// Limit the generated-code exemption to files installed from the registry.
const registryComponents = [
  'attachment',
  'badge',
  'bubble',
  'button',
  'code-block',
  'collapsible',
  'dialog',
  'dropdown-menu',
  'field',
  'input-group',
  'input',
  'label',
  'message-scroller',
  'message',
  'popover',
  'progress',
  'resizable',
  'select',
  'separator',
  'sheet',
  'spinner',
  'table',
  'tabs',
  'textarea',
  'toast',
  'tooltip',
  'trace',
];

export const shadcnIgnores = registryComponents.map((name) => `src/components/${name}.tsx`);
