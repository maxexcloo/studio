// A click outside an open popup (popover, menu or dropdown, marked `data-popup` by the theme) only
// closes it. Mantine closes popups on mousedown/touchstart; the press keeps focus where it is and
// the click that follows never reaches what lies beneath. Pressing a popup's own trigger still
// toggles it.

/** Matches every popup dropdown, including kept-mounted hidden and closing ones. */
export const popupLayer = "[data-popup]";
let closing = false;

/** Whether the current press is dismissing a popup, so outside-click handlers can ignore it. */
export const closingPopup = () => closing;

// Select keeps its dropdown mounted but hidden, and a closing layer fades towards opacity 0.
const shown = (layer: HTMLElement) => layer.getClientRects().length && layer.style.opacity !== "0";
const popupOpen = () => [...document.querySelectorAll<HTMLElement>(popupLayer)].some(shown);

/**
 * Whether an open popup, dialog or drawer is stacked over `owner` (over the page without one). A
 * press outside or Escape then belongs to that topmost layer, so `owner`'s own outside-click and
 * Escape handlers leave it alone. Layers portal to the end of the page as they open, so one above
 * `owner` follows it there, and the layer `owner` sits in does not count. A key handler passes its
 * event: Escape belongs to any layer above, other keys only to the one they were pressed in, so a
 * key straight after closing a layer is not lost while it fades.
 */
export const layerAbove = (
  owner: Element | null = null,
  key?: KeyboardEvent | React.KeyboardEvent,
) => {
  const target = key && key.key !== "Escape" ? key.target : undefined;
  return [
    ...document.querySelectorAll<HTMLElement>(
      `${popupLayer}, .mantine-Modal-content, .mantine-Drawer-content`,
    ),
  ].some(
    (layer) =>
      shown(layer) &&
      !layer.contains(owner) &&
      (target === undefined || layer.contains(target as Node | null)) &&
      (!owner || owner.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
};

/**
 * A Modal or Drawer `onClose` (give the dialog this `id`) that does nothing while another layer is
 * open over it: Mantine closes every open dialog on Escape, not only the topmost.
 */
export const closeWhenTop = (id: string, close: () => void) => () => {
  if (!layerAbove(document.getElementById(`${id}-body`))) close();
};

window.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target as Element;
    // A dialog opened from a popup, such as a delete confirmation, sits above it and owns its clicks.
    closing =
      !target.closest(`${popupLayer}, [aria-expanded="true"], .mantine-Modal-root`) && popupOpen();
  },
  true,
);
window.addEventListener("mousedown", (event) => closing && event.preventDefault(), true);
window.addEventListener(
  "click",
  (event) => {
    // Keyboard activation (detail 0) never follows a press.
    if (!closing || event.detail === 0) return;
    closing = false;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);
