import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Notifications } from "@mantine/notifications";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { failure } from "./api";
import { App } from "./App";
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
// The first frame waits briefly for Geist, so text doesn't reflow when the fallback font swaps out.
const fontReady = Promise.race([
  document.fonts.load('1em "Geist Variable"'),
  new Promise((resolve) => setTimeout(resolve, 500)),
]).catch(() => {});
void fontReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <AppearanceProvider>
      <QueryClientProvider client={client}>
        {/* Stream updates must not keep declarative route changes in a pending transition. */}
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
        <Notifications position="top-right" />
      </QueryClientProvider>
    </AppearanceProvider>,
  ),
);
