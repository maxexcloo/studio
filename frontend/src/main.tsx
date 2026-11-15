import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { Notifications } from "@mantine/notifications";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { failure } from "./api";
import { App } from "./App";
import { useAppearancePreference } from "./features/settings/accountPreferences";
import { AppearanceProvider } from "./ui/Appearance";
import "./ui/popupClicks";

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
        <Notifications position="bottom-right" />
      </AccountAppearance>
    </QueryClientProvider>,
  ),
);
