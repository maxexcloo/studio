// The phone's main screens scroll the document (iOS scrolls only the document
// to the top on a tap on the status bar); the desktop scrolls its own panes.
// These read either kind of scroller the same way.

export function isDocumentScroller(element: Element | null | undefined) {
  return Boolean(element) && (element === document.scrollingElement || element === document.documentElement || element === document.body);
}

/** The scroller's top edge on screen: the viewport's for the document. */
export function scrollerTop(element: Element) {
  return isDocumentScroller(element) ? 0 : element.getBoundingClientRect().top;
}

/** Where its scroll events arrive: the window for the document. */
export function scrollEvents(element: Element): EventTarget {
  return isDocumentScroller(element) ? window : element;
}
