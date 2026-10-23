import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";

export interface AccountStatus {
  mode: string;
  signedIn: boolean;
  needsRecoveryAdmin?: boolean;
  setupTokenAccepted?: boolean;
  account?: { id: string; role: "administrator" | "user" };
  oidc?: { label: string };
}
export function useAccount() {
  return useQuery({
    queryKey: ["account"],
    queryFn: () => api<AccountStatus>("/api/accounts/status"),
    retry: false,
  });
}
export function AccountGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useAccount();
  const access = useQuery({
    queryKey: ["access"],
    queryFn: () =>
      api<{ signedIn: boolean; canAdmin: boolean; studioPassword: { set: boolean } }>(
        "/api/access/status",
      ),
    enabled: status.data?.mode === "single-user",
    retry: false,
  });
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [setupToken, setSetupToken] = useState(""),
    [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
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
  const multi = status.data?.mode === "multi-user",
    bootstrap = !!status.data?.needsRecoveryAdmin;
  if (multi ? status.data?.signedIn : access.data?.signedIn) return children;
  return (
    <Container size="xs" py="xl">
      <Paper>
        <Stack>
          <Title order={1}>Studio</Title>
          <Text c="dimmed">
            {bootstrap
              ? "Create the recovery administrator for your workspace."
              : "Sign in to your creative workspace."}
          </Text>
          {outcome && <Alert>{outcome}</Alert>}
          {!multi && !access.data?.studioPassword.set ? (
            <Alert>
              Set a Studio password on the computer running Studio before opening it on other
              devices.
            </Alert>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setPending(true);
                try {
                  await post(
                    multi
                      ? bootstrap
                        ? "/api/accounts/bootstrap"
                        : "/api/accounts/sign-in"
                      : "/api/access/sign-in",
                    multi
                      ? { username, password, ...(bootstrap ? { setupToken, displayName } : {}) }
                      : { password },
                  );
                  setPassword("");
                  setSetupToken("");
                  client.clear();
                  await status.refetch();
                  if (!multi) await access.refetch();
                } catch (error) {
                  failure(error);
                } finally {
                  setPending(false);
                }
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
                <Button type="submit" loading={pending}>
                  {bootstrap ? "Create Administrator" : "Sign In"}
                </Button>
              </Stack>
            </form>
          )}
          {status.data?.oidc && (
            <Anchor href="/api/accounts/oidc/start">Sign In With {status.data.oidc.label}</Anchor>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
