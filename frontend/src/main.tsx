import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { useMantineTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { failure } from "./api";
import { App } from "./App";
import { useAppearancePreference } from "./features/settings/accountPreferences";
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
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});
function AccountAppearance({ children }: { children: ReactNode }) {
  return <AppearanceProvider {...useAppearancePreference()}>{children}</AppearanceProvider>;
}
function AppNotifications() {
  const phone = usePhone();
  const theme = useMantineTheme();
  const swipe = useRef<{ close: HTMLButtonElement; id: number; x: number; y: number } | null>(null);
  return (
    <Notifications
      position="top-center"
      containerWidth={400}
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
// The gallery places its own scroll when the viewer closes through Back; iOS Safari's restoration
// of the opening position would land afterwards and override it.
history.scrollRestoration = "manual";
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
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
        <AppNotifications />
      </AccountAppearance>
    </QueryClientProvider>,
  ),
);
