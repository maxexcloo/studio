// A click outside an open popup (popover, menu or dropdown, marked `data-popup` by the theme) only
// closes it. Mantine closes popups on mousedown/touchstart; the press keeps focus where it is and
// the click that follows never reaches what lies beneath. Pressing a popup's own trigger still
// toggles it.

/** Matches every popup dropdown, including kept-mounted hidden and closing ones. */
export const popupLayer = "[data-popup]";
let closing = false;

/** Whether the current press is dismissing a popup, so outside-click handlers can ignore it. */
export const closingPopup = () => closing;

// Select keeps its dropdown mounted but hidden, and a closing popup fades towards opacity 0.
const popupOpen = () =>
  [...document.querySelectorAll<HTMLElement>(popupLayer)].some(
    (layer) => layer.getClientRects().length && layer.style.opacity !== "0",
  );

window.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target as Element;
    closing = !target.closest(`${popupLayer}, [aria-expanded="true"]`) && popupOpen();
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
