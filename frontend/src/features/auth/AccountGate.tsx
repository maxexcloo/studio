import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Center,
  Container,
  Divider,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { Account } from "../../types";
import type { McpTokenStatus } from "../settings/PersonalMcpToken";
import { StudioLogo } from "../../ui/StudioLogo";

interface AccountStatus {
  mode: string;
  signedIn: boolean;
  needsRecoveryAdmin?: boolean;
  account?: Pick<Account, "id" | "role" | "features"> | null;
  oidc?: { label: string };
}
export function useAccount() {
  return useQuery({
    queryKey: ["account"],
    queryFn: () => api<AccountStatus>("/api/accounts/status"),
    retry: false,
  });
}
/** Unknown until the account status loads, so admin-only UI never flashes in. */
export function useIsAdmin() {
  const { data } = useAccount();
  return !!data && (data.mode !== "multi-user" || data.account?.role === "administrator");
}
/** A group feature that is on unless the account's group turns it off (Chat, Dream, Prompt Assistant). */
export function useGroupFeature(feature: "chat" | "dream" | "promptAssistant") {
  return useAccount().data?.account?.features?.[feature] !== false;
}
export const ownAccountQuery = queryOptions({
  queryKey: ["own-account"],
  queryFn: () => api<{ account: Account; mcp?: McpTokenStatus }>("/api/accounts/me"),
});
// Set while Studio sends the browser to single sign-on, so a return still signed out shows the form.
const oidcAttempt = "studio-oidc-attempt";

export function AccountGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useAccount();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [query] = useState(() => new URLSearchParams(window.location.search));
  const [outcome] = useState(
    () =>
      ({
        refused: "This account is disabled or was deleted. Ask an administrator.",
        failed: "Single sign-on did not complete. Try again.",
        unavailable: "Single sign-on is unavailable right now.",
        "signed-out": "Signed out.",
      })[query.get("sign-in") || ("" as "refused")] ||
      (sessionStorage.getItem(oidcAttempt) ? "Single sign-on did not sign you in." : undefined),
  );
  useEffect(() => {
    const signOut = () => {
      client.clear();
      void status.refetch();
    };
    window.addEventListener("studio:signed-out", signOut);
    return () => window.removeEventListener("studio:signed-out", signOut);
  }, [client]);
  const multi = status.data?.mode === "multi-user",
    bootstrap = !!status.data?.needsRecoveryAdmin;
  // Signed out with single sign-on set up goes straight to it, unless it just failed, the account
  // signed out or ?password=1 asks for the form (the recovery administrator and local accounts).
  const toOidc =
    multi &&
    status.data?.signedIn === false &&
    !!status.data.oidc &&
    !bootstrap &&
    !outcome &&
    !query.has("password");
  useEffect(() => {
    if (status.data?.signedIn) sessionStorage.removeItem(oidcAttempt);
    if (!toOidc) return;
    sessionStorage.setItem(oidcAttempt, "1");
    window.location.replace("/api/accounts/oidc/start");
  }, [toOidc, status.data?.signedIn]);
  const signIn = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post(bootstrap ? "/api/accounts/bootstrap" : "/api/accounts/sign-in", {
        username,
        password,
      }),
    onSuccess: async () => {
      setPassword("");
      client.clear();
      await status.refetch();
    },
  });
  if (status.isPending || toOidc)
    return (
      <Center h="100dvh">
        <Loader aria-label="Loading Studio" />
      </Center>
    );
  if (status.error)
    return (
      <Container py="xl">
        <Alert color="red" title="Can’t Reach Studio">
          {status.error.message}
          <Button onClick={() => void status.refetch()}>Retry</Button>
        </Alert>
      </Container>
    );
  // Single-user Studio answers only the computer it runs on, which needs no sign-in.
  if (!multi || status.data?.signedIn) return children;
  return (
    <Stack mih="100dvh" justify="center" py="xl" px="md">
      <Container size={420} w="100%" px={0}>
        <Stack gap="xl">
          <Stack gap="xs" align="center">
            <StudioLogo order={1} />
            <Text c="dimmed" ta="center">
              Your creative workspace.
            </Text>
          </Stack>
          <Paper withBorder shadow="md" p="xl" radius="md">
            <Stack gap="lg">
              <Title order={2} size="h3">
                {bootstrap ? "Set Up Studio" : "Welcome Back"}
              </Title>
              {bootstrap && (
                <Text size="sm" c="dimmed">
                  Create the recovery administrator for your workspace.
                </Text>
              )}
              {outcome && <Alert>{outcome}</Alert>}
              {status.data?.oidc && (
                <>
                  <Button component="a" href="/api/accounts/oidc/start" variant="default" fullWidth>
                    Sign In With {status.data.oidc.label}
                  </Button>
                  <Divider label="Or Continue with Email" labelPosition="center" />
                </>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  signIn.mutate();
                }}
              >
                <Stack>
                  <TextInput
                    label="Email"
                    type={bootstrap ? "email" : "text"}
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.currentTarget.value)}
                  />
                  <PasswordInput
                    label="Password"
                    autoComplete={bootstrap ? "new-password" : "current-password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                  />
                  {signIn.error && <Alert color="red">{signIn.error.message}</Alert>}
                  <Button type="submit" loading={signIn.isPending} fullWidth mt="sm">
                    {bootstrap ? "Create Administrator" : "Sign In"}
                  </Button>
                </Stack>
              </form>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Stack>
  );
}
