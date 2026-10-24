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
  setupTokenAccepted?: boolean;
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
export function useAccess(enabled: boolean) {
  return useQuery({
    queryKey: ["access"],
    queryFn: () =>
      api<{
        signedIn: boolean;
        thisComputer: boolean;
        canAdmin: boolean;
        studioPassword: { set: boolean };
      }>("/api/access/status"),
    enabled,
    retry: false,
  });
}
export function AccountGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useAccount();
  const access = useAccess(status.data?.mode === "single-user");
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [setupToken, setSetupToken] = useState(""),
    [displayName, setDisplayName] = useState("");
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
      void access.refetch();
    };
    window.addEventListener("studio:signed-out", signOut);
    return () => window.removeEventListener("studio:signed-out", signOut);
  }, [client]);
  const multi = status.data?.mode === "multi-user",
    bootstrap = !!status.data?.needsRecoveryAdmin;
  const signIn = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      multi
        ? post(bootstrap ? "/api/accounts/bootstrap" : "/api/accounts/sign-in", {
            username,
            password,
            ...(bootstrap ? { setupToken, displayName } : {}),
          })
        : post("/api/access/sign-in", { password }),
    onSuccess: async () => {
      setPassword("");
      setSetupToken("");
      client.clear();
      await status.refetch();
      if (!multi) await access.refetch();
    },
  });
  if (status.isPending || (status.data?.mode === "single-user" && access.isPending))
    return (
      <Container py="xl">
        <Loader aria-label="Loading Studio" />
      </Container>
    );
  const error = status.error || access.error;
  if (error)
    return (
      <Container py="xl">
        <Alert color="red" title="Can’t Reach Studio">
          {error.message}
          <Button
            onClick={() => {
              void status.refetch();
              void access.refetch();
            }}
          >
            Try Again
          </Button>
        </Alert>
      </Container>
    );
  if (multi ? status.data?.signedIn : access.data?.signedIn) return children;
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
                  <Divider
                    label={multi ? "Or Continue With Email" : "Or Continue With Password"}
                    labelPosition="center"
                  />
                </>
              )}
              {!multi && !access.data?.studioPassword.set ? (
                <Alert>
                  Set a Studio password on the computer running Studio before opening it on other
                  devices.
                </Alert>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    signIn.mutate();
                  }}
                >
                  <Stack>
                    {multi && (
                      <TextInput
                        label="Email"
                        type={bootstrap ? "email" : "text"}
                        autoComplete="username"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.currentTarget.value)}
                      />
                    )}
                    {bootstrap && (
                      <TextInput
                        label="Display Name"
                        autoComplete="name"
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.currentTarget.value)}
                      />
                    )}
                    <PasswordInput
                      label="Password"
                      autoComplete={bootstrap ? "new-password" : "current-password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.currentTarget.value)}
                    />
                    {bootstrap && status.data?.setupTokenAccepted && (
                      <PasswordInput
                        label="Setup Token"
                        autoComplete="off"
                        value={setupToken}
                        onChange={(e) => setSetupToken(e.currentTarget.value)}
                      />
                    )}
                    {signIn.error && <Alert color="red">{signIn.error.message}</Alert>}
                    <Button type="submit" loading={signIn.isPending} fullWidth mt="sm">
                      {bootstrap ? "Create Administrator" : "Sign In"}
                    </Button>
                  </Stack>
                </form>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Stack>
  );
}
