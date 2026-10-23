import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { cssVariablesResolver, theme } from "./theme";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});
createRoot(document.getElementById("root")!).render(
  <MantineProvider
    theme={theme}
    cssVariablesResolver={cssVariablesResolver}
    defaultColorScheme="dark"
  >
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Notifications position="top-right" />
    </QueryClientProvider>
  </MantineProvider>,
);
