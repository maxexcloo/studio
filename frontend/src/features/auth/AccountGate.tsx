import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
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
export const ownAccountQuery = queryOptions({
  queryKey: ["own-account"],
  queryFn: () => api<{ account: Account; mcp?: McpTokenStatus }>("/api/accounts/me"),
});
export function AccountGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useAccount();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [outcome] = useState(
    () =>
      ({
        pending: "An administrator needs to approve this account before you can open Studio.",
        refused: "This account is disabled. Ask an administrator.",
        failed: "Single sign-on did not complete. Try again.",
        unavailable: "Single sign-on is unavailable right now.",
      })[new URLSearchParams(window.location.search).get("sign-in") || ("" as "pending")],
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
  if (status.isPending)
    return (
      <Container py="xl">
        <Loader aria-label="Loading Studio" />
      </Container>
    );
  if (status.error)
    return (
      <Container py="xl">
        <Alert color="red" title="Can’t Reach Studio">
          {status.error.message}
          <Button onClick={() => void status.refetch()}>Try Again</Button>
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
                  <Divider label="Or Continue With Email" labelPosition="center" />
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
