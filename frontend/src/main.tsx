import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AppearanceProvider } from "./ui/Appearance";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});
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
);
