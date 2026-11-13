import { useEffect, useState } from 'react';

export function createClientModule<Module extends object>(load: () => Promise<Module>) {
  let loaded: Module | undefined;
  let request: Promise<Module> | undefined;

  function prepare() {
    request ??= load().then((module) => {
      loaded = module;
      return module;
    });

    return request;
  }

  function useModule() {
    const [module, setModule] = useState(() => loaded);
    const [failure, setFailure] = useState<{ reason: unknown }>();

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
        (reason: unknown) => {
          if (active) {
            setFailure({ reason });
          }
        },
      );

      return () => {
        active = false;
      };
    }, [module]);

    if (failure) {
      throw failure.reason;
    }

    return module;
  }

  return { prepare, useModule };
}
