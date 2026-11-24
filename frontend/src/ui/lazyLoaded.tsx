import { type ComponentType, lazy, useState } from "react";

import { reloadOnce } from "./reloadOnce";

/**
 * A component loaded on demand. Once `preload` has run it renders at once, where `lazy` alone would
 * still suspend on its first render, showing its fallback for a moment after preloading.
 */
export function lazyLoaded<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  let loaded: ComponentType<Props> | undefined;
  const preload = () =>
    load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        reloadOnce();
        throw error;
      },
    );
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function Loaded(props: Props) {
    const [Shown] = useState(() => loaded || Lazy);
    return <Shown {...props} />;
  }
  return [Loaded, preload] as const;
}
