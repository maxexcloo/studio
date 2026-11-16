import type { PopoverContextValue } from "@mantine/core";

// A click outside an open popup (popover, menu or dropdown, marked `data-popup` by the theme) only
// closes the topmost layer through its Mantine state owner. The press keeps focus where it is,
// and its release and click never reach what lies beneath. A popup's own trigger still toggles it.

/** Matches every popup dropdown, including kept-mounted hidden and closing ones. */
export const popupLayer = "[data-popup]";
let closing = false;
let managedPress = false;
const popups = new WeakMap<HTMLElement, PopoverContextValue>();

/** The dropdown keeps Mantine's state owner, including controlled menus and comboboxes. */
export const registerPopup = (root: HTMLElement, context: PopoverContextValue) => {
  popups.set(root, context);
  return () => {
    if (popups.get(root) === context) popups.delete(root);
  };
};
const dismiss = (context: PopoverContextValue) => {
  context.onClose?.();
  context.onDismiss?.();
};

/** Whether the current press is dismissing a popup, so outside-click handlers can ignore it. */
export const closingPopup = () => closing;

// Select keeps its dropdown mounted but hidden, and a closing layer fades towards opacity 0. A
// popover's trigger (Mantine gives it the dropdown's id less `-dropdown`) reports it collapsed a
// frame before the fade starts, and expanded while it still waits at opacity 0 to fade in, so the
// trigger decides where there is one. A dialog has no trigger: at opacity 0 it is closing once it
// has been seen open, and otherwise still waiting to fade in.
const seenOpen = new WeakSet<HTMLElement>();
const shown = (layer: HTMLElement) => {
  if (!layer.getClientRects().length) return false;
  const context = popups.get(layer);
  if (context) return context.opened;
  const expanded = document.getElementById(layer.id.replace(/-dropdown$/, ""))?.ariaExpanded;
  if (expanded) return expanded === "true";
  if (layer.style.opacity !== "0") seenOpen.add(layer);
  return layer.style.opacity !== "0" || !seenOpen.has(layer);
};
const openLayers = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      `${popupLayer}, .mantine-Modal-content, .mantine-Drawer-content`,
    ),
  ].filter(shown);

// The layers open as each key went down: a layer its own Escape closes still owns that Escape
// once it has closed, so handlers beneath that see it later leave it alone.
let pressed: { event: Event; layers: HTMLElement[] } | undefined;
window.addEventListener(
  "keydown",
  (event) => {
    const layers = openLayers();
    pressed = { event, layers };
    const top = layers.at(-1);
    const context = top && popups.get(top);
    if (event.key === "Escape" && !event.isComposing && top && context?.closeOnEscape) {
      dismiss(context);
      event.preventDefault();
      event.stopPropagation();
    }
  },
  true,
);

/**
 * Whether an open popup, dialog or drawer is stacked over `owner` (over the page without one). A
 * press outside or Escape then belongs to that topmost layer, so `owner`'s own outside-click and
 * Escape handlers leave it alone. Layers portal to the end of the page as they open, so one above
 * `owner` follows it there, and the layer `owner` sits in does not count. A key handler passes its
 * event, and the layers open as that key went down decide: Escape belongs to any layer above, other
 * keys only to the one they were pressed in, so a key straight after closing a layer is not lost
 * while it fades.
 */
export const layerAbove = (
  owner: Element | null = null,
  key?: KeyboardEvent | React.KeyboardEvent,
) => {
  const event = key && "nativeEvent" in key ? key.nativeEvent : key;
  const target = key && key.key !== "Escape" ? key.target : undefined;
  return (event && pressed?.event === event ? pressed.layers : openLayers()).some(
    (layer) =>
      !layer.contains(owner) &&
      (target === undefined || layer.contains(target as Node | null)) &&
      (!owner || owner.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
};

/**
 * A Modal or Drawer `onClose` (give the dialog this `id`) that does nothing while another layer is
 * open over it: Mantine closes every open dialog on Escape, not only the topmost. React may already
 * have closed the layer above in an earlier listener for the same Escape, so the layers open as
 * that key went down decide.
 */
export const closeWhenTop = (id: string, close: () => void) => () => {
  const key = window.event instanceof KeyboardEvent ? window.event : undefined;
  if (!layerAbove(document.getElementById(`${id}-body`), key)) close();
};

window.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target as Element;
    if (target.closest(".mantine-Notification-root")) {
      closing = false;
      managedPress = false;
      return;
    }
    // Sees dialogs before a press closes one, and excludes native popups as soon as they close.
    const layers = openLayers();
    const top = layers.at(-1);
    const context = top && popups.get(top);
    managedPress = layers.some((layer) => popups.has(layer));
    if (!top || !context) {
      closing = false;
      return;
    }
    // Comboboxes control a listbox inside the dropdown rather than the dropdown itself.
    const trigger =
      document.getElementById(context.getTargetId()) ||
      [...document.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]')].find(
        (control) =>
          control
            .getAttribute("aria-controls")!
            .split(" ")
            .some((id) => {
              const list = document.getElementById(id);
              return list && top.contains(list);
            }),
      );
    const control = trigger?.closest(".mantine-Input-wrapper") || trigger;
    closing = !top.contains(target) && !control?.contains(target);
    if (closing && top.dataset.popupOutside !== "false") {
      dismiss(context);
      // The same press must not arm a hold or another action beneath the popup.
      event.stopPropagation();
    }
  },
  true,
);
window.addEventListener("pointercancel", () => (closing = false), true);
for (const name of ["mousedown", "touchstart"]) {
  window.addEventListener(
    name,
    (event) => {
      if (!closing) return;
      if (name === "mousedown") event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  // Let React and native controls handle presses inside the popup first. Mantine's independent
  // document listeners must not then dismiss its parents, including parents in other portals.
  document.addEventListener(name, (event) => {
    if (managedPress) event.stopImmediatePropagation();
  });
}
for (const name of ["pointerup", "mouseup", "touchend"]) {
  window.addEventListener(
    name,
    (event) => {
      if (closing) event.stopPropagation();
    },
    true,
  );
}
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
