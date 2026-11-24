import { lazyLoaded } from "../../ui/lazyLoaded";

export const [ZoomImage, loadZoomImage] = lazyLoaded(() =>
  import("./ZoomImage").then((module) => module.ZoomImage),
);
// The image chunk loads once the page is idle, so a viewer opened after that shows it at once.
(window.requestIdleCallback || setTimeout)(() => void loadZoomImage());
