import { Context } from 'cordis';

export interface Services {
  // Cordis service names are strings. Plugins add named keys by module augmentation.
  [name: symbol]: never;
}

type ServiceName = Extract<keyof Services, string>;
type Cleanup = () => void | Promise<void>;

export interface PluginContext {
  get<K extends ServiceName>(name: K): Services[K];
  provide<K extends ServiceName>(name: K, value: Services[K]): void;
  onDispose(cleanup: Cleanup): void;
}

export interface Plugin {
  id: string;
  requires?: readonly ServiceName[];
  provides?: readonly ServiceName[];
  setup(context: PluginContext): void | Promise<void>;
}

export interface Runtime {
  get<K extends ServiceName>(name: K): Services[K];
  dispose(): Promise<void>;
}

function getService<K extends ServiceName>(context: Context, name: K): Services[K];
function getService(context: Context, name: string): unknown {
  // The proxy also resolves services staged by the plugin during setup.
  const service: unknown = Reflect.get(context, name);
  if (service === undefined) {
    throw new Error(`Service "${name}" is unavailable`);
  }
  return service;
}

function serviceLabel(name: string) {
  return `"${name}"`;
}

function orderPlugins(plugins: readonly Plugin[]): Plugin[] {
  const ids = new Set<string>();
  const providers = new Map<string, Plugin>();

  for (const plugin of plugins) {
    if (ids.has(plugin.id)) {
      throw new Error(`Duplicate plugin: ${plugin.id}`);
    }

    ids.add(plugin.id);

    for (const name of plugin.provides ?? []) {
      const previous = providers.get(name);
      if (previous) {
        throw new Error(`Duplicate service ${serviceLabel(name)}: ${previous.id}, ${plugin.id}`);
      }
      providers.set(name, plugin);
    }
  }

  const visiting = new Set<Plugin>();
  const visited = new Set<Plugin>();
  const ordered: Plugin[] = [];

  function visit(plugin: Plugin): void {
    if (visiting.has(plugin)) {
      throw new Error(`Cyclic plugin dependency: ${plugin.id}`);
    }
    if (visited.has(plugin)) {
      return;
    }
    visiting.add(plugin);

    for (const name of plugin.requires ?? []) {
      const provider = providers.get(name);
      if (!provider) {
        throw new Error(`Plugin "${plugin.id}" requires missing service ${serviceLabel(name)}`);
      }
      visit(provider);
    }

    visiting.delete(plugin);
    visited.add(plugin);
    ordered.push(plugin);
  }

  plugins.forEach(visit);

  return ordered;
}

export async function createRuntime(plugins: readonly Plugin[]): Promise<Runtime> {
  // Reject invalid product compositions before any plugin acquires resources.
  const ordered = orderPlugins(plugins);
  const context = new Context();

  try {
    for (const plugin of ordered) {
      const handle = context.plugin({
        name: plugin.id,
        inject: [...(plugin.requires ?? [])],
        provide: [...(plugin.provides ?? [])],
        async apply(scope: Context) {
          const published = new Set<ServiceName>();
          await plugin.setup({
            get(name) {
              if (!plugin.requires?.includes(name) && !plugin.provides?.includes(name)) {
                throw new Error(
                  `Plugin "${plugin.id}" did not declare service ${serviceLabel(name)}`,
                );
              }
              return getService(scope, name);
            },
            provide(name, value) {
              if (!plugin.provides?.includes(name) || value === undefined) {
                throw new Error(
                  `Plugin "${plugin.id}" cannot provide service ${serviceLabel(name)}`,
                );
              }
              scope.provide(name, value);
              published.add(name);
            },
            onDispose(cleanup) {
              scope.effect(() => cleanup);
            },
          });

          for (const name of plugin.provides ?? []) {
            if (!published.has(name)) {
              throw new Error(
                `Plugin "${plugin.id}" did not provide service ${serviceLabel(name)}`,
              );
            }
          }
        },
      });

      await handle;
      if (!handle.committed) {
        throw new Error(`Plugin "${plugin.id}" did not activate`);
      }
    }
  } catch (error) {
    await context.fiber.dispose();
    throw error;
  }

  let disposal: Promise<void> | undefined;

  return {
    get(name) {
      if (disposal) {
        throw new Error('Runtime is disposed');
      }
      return getService(context, name);
    },
    dispose() {
      return (disposal ??= context.fiber.dispose());
    },
  };
}
