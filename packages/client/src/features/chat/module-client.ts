import { useEffect, useState } from 'react';

export function createClientModule<Module extends object>(load: () => Promise<Module>) {
  let loaded: Module | undefined;
  let request: Promise<Module> | undefined;

  function prepare() {
    request ??= load().then(
      (module) => {
        loaded = module;
        return module;
      },
      (error: unknown) => {
        request = undefined;
        console.error('Could not load a Chat module.', error);
        throw error;
      },
    );

    return request;
  }

  function useModule() {
    const [module, setModule] = useState(() => loaded);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (module !== undefined) {
        return;
      }

      let active = true;
      void prepare().then(
        (result) => {
          if (active) {
            setModule(() => result);
          }
        },
        () => {
          if (active) {
            setFailed(true);
          }
        },
      );

      return () => {
        active = false;
      };
    }, [module]);

    return { module, failed };
  }

  return { prepare, useModule };
}
