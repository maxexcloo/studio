import { lazy } from "react";

// The image chunk loads once the page is idle; a viewer opened after that renders it directly
// instead of flashing the Suspense fallback.
let loaded: typeof import("./ZoomImage").ZoomImage | undefined;
const load = () =>
  import("./ZoomImage").then((module) => ({ default: (loaded = module.ZoomImage) }));
const LazyZoomImage = lazy(load);
(window.requestIdleCallback || setTimeout)(() => void load());

/** ZoomImage once its chunk has loaded, otherwise a lazy one; keep the first a viewer gets. */
export const zoomImage = () => loaded || LazyZoomImage;
