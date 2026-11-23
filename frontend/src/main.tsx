import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { useMantineTheme } from "@mantine/core";
import { Notifications, notifications, useNotifications } from "@mantine/notifications";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { unstable_HistoryRouter as HistoryRouter, UNSAFE_createBrowserHistory } from "react-router";

import { failure } from "./api";
import { App } from "./App";
import { useAppearancePreference } from "./features/settings/accountPreferences";
import { singleEntry } from "./singleEntry";
import { AppearanceProvider } from "./ui/Appearance";
import "./ui/popupClicks";
import { usePhone } from "./ui/usePhone";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { inlineError?: boolean };
  }
}
const client = new QueryClient({
  // Every failed action notifies once here; forms that render `mutation.error` set `inlineError`.
  mutationCache: new MutationCache({
    onError: (error, _variables, _result, mutation) => {
      if (!mutation.meta?.inlineError && error.name !== "AbortError") failure(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Reads ride out a restart (server errors and unreachable Studio); refusals fail at once.
      retry: (count, error) => {
        const { status } = error as { status?: number };
        return count < 2 && (status === undefined || status >= 500);
      },
      refetchOnWindowFocus: true,
    },
  },
});
function AccountAppearance({ children }: { children: ReactNode }) {
  return <AppearanceProvider {...useAppearancePreference()}>{children}</AppearanceProvider>;
}
function AppNotifications() {
  const phone = usePhone();
  const theme = useMantineTheme();
  const swipe = useRef<{ close: HTMLButtonElement; id: number; x: number; y: number } | null>(null);
  // New feedback replaces what occupies its position. Fading feedback takes no input or focus.
  const { notifications: shown, queue } = useNotifications();
  useEffect(() => {
    if (!queue.length) return;
    for (const { id, position = "top-right", priority = 0 } of shown) {
      const replaces = queue.some(
        (next) => (next.position ?? "top-right") === position && (next.priority ?? 0) >= priority,
      );
      if (!replaces) continue;
      const banner = document.getElementById(id!);
      banner?.setAttribute("inert", "");
      banner?.setAttribute("aria-hidden", "true");
      notifications.hide(id!);
    }
  }, [shown, queue]);
  return (
    <Notifications
      position="top-right"
      limit={1}
      containerWidth={320}
      transitionDuration={theme.other.motionDuration}
      allowDragDismiss={!phone}
      onTouchStart={(event) => {
        swipe.current = null;
        const target = event.target as Element;
        if (!phone || event.touches.length !== 1 || target.closest("button, a, input, textarea"))
          return;
        // Use Mantine's own dismiss control, preserving allowClose and the notification lifecycle.
        const close = target
          .closest(".mantine-Notification-root")
          ?.querySelector<HTMLButtonElement>(".mantine-Notification-closeButton");
        const touch = event.touches[0];
        if (close)
          swipe.current = { close, id: touch.identifier, x: touch.clientX, y: touch.clientY };
      }}
      onTouchCancel={() => (swipe.current = null)}
      onTouchEnd={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || event.touches.length) return;
        const touch = Array.from(event.changedTouches).find(
          (touch) => touch.identifier === start.id,
        );
        if (!touch) return;
        const up = start.y - touch.clientY;
        if (up > 40 && up > Math.abs(touch.clientX - start.x) && start.close.isConnected)
          start.close.click();
      }}
    />
  );
}
// Keep iOS history gestures from taking over Studio's swipes.
document.addEventListener(
  "touchstart",
  (event) => {
    if (!event.cancelable || event.touches.length !== 1) return;
    const edge = 20;
    const start = event.touches[0];
    const { clientX } = start;
    if (clientX > edge && clientX < window.innerWidth - edge) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest("input, textarea, select, label") ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    if (
      target.closest("a, button") &&
      (!target.closest("[data-zoom-mode]") || target.closest("[data-zoom-controls]"))
    ) {
      // Leave taps alone. Only an inward drag from the edge consumes the control's touch.
      const edgeGesture = new AbortController();
      const { signal } = edgeGesture;
      const finish = () => edgeGesture.abort();
      document.addEventListener("touchend", finish, { capture: true, signal });
      document.addEventListener("touchcancel", finish, { capture: true, signal });
      document.addEventListener(
        "touchmove",
        (move) => {
          const touch = move.touches[0];
          if (move.touches.length !== 1 || touch.identifier !== start.identifier) {
            finish();
            return;
          }
          const inward = (touch.clientX - clientX) * (clientX <= edge ? 1 : -1);
          const vertical = Math.abs(touch.clientY - start.clientY);
          if (vertical >= 8 && vertical >= inward) finish();
          else if (inward >= 8 && move.cancelable) move.preventDefault();
        },
        { capture: true, passive: false, signal },
      );
      return;
    }
    event.preventDefault();
  },
  { capture: true, passive: false },
);
// The gallery places its own scroll when the viewer closes through Back; iOS Safari's restoration
// of the opening position would land afterwards and override it.
history.scrollRestoration = "manual";
const routerHistory = UNSAFE_createBrowserHistory({ v5Compat: true });
if (
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
)
  singleEntry(routerHistory, sessionStorage);
// The first frame waits briefly for Geist, so text doesn't reflow when the fallback font swaps out.
const fontReady = Promise.race([
  document.fonts.load('1em "Geist Variable"'),
  new Promise((resolve) => setTimeout(resolve, 500)),
]).catch(() => {});
void fontReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <AccountAppearance>
        {/* Stream updates must not keep declarative route changes in a pending transition. */}
        <HistoryRouter history={routerHistory} useTransitions={false}>
          <App />
        </HistoryRouter>
        <AppNotifications />
      </AccountAppearance>
    </QueryClientProvider>,
  ),
);
