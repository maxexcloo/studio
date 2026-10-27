import { Accordion, Alert, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import type { Account } from "../../types";
import { ownAccountQuery } from "../auth/AccountGate";
import { PersonalMcpToken } from "./PersonalMcpToken";
function AccountForm({ account }: { account: Account }) {
  const client = useQueryClient();
  const security = useForm({
    initialValues: { username: account.username, currentPassword: "", newPassword: "" },
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => {
      const current = security.getValues();
      return api<{ account: Account }>("/api/accounts/me", {
        method: "PATCH",
        body: JSON.stringify({
          ...(current.username !== account.username ? { username: current.username } : {}),
          currentPassword: current.currentPassword,
          ...(current.newPassword ? { newPassword: current.newPassword } : {}),
        }),
      });
    },
    onSuccess: ({ account }) => {
      security.setValues({ username: account.username, currentPassword: "", newPassword: "" });
      void client.invalidateQueries({ queryKey: ownAccountQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["account-admin"] });
      notifications.show({ message: "Account updated" });
    },
    onSettled: () => security.setValues({ currentPassword: "", newPassword: "" }),
  });
  const securityChanged =
    security.values.username !== account.username || !!security.values.newPassword;
  return (
    <Stack>
      {account.accessProfile && (
        <Text size="sm" c="dimmed">
          Access group: {account.accessProfile.name}
        </Text>
      )}
      {account.canChangeEmail || account.canChangePassword ? (
        <Accordion transitionDuration={0}>
          <Accordion.Item value="security">
            <Accordion.Control>Email & Password</Accordion.Control>
            <Accordion.Panel>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate();
                }}
              >
                <Stack>
                  {account.canChangeEmail && (
                    <TextInput
                      label="Email"
                      type="email"
                      autoComplete="username"
                      required
                      {...security.getInputProps("username")}
                    />
                  )}
                  <PasswordInput
                    label="Current Password"
                    autoComplete="current-password"
                    required
                    {...security.getInputProps("currentPassword")}
                  />
                  {account.canChangePassword && (
                    <PasswordInput
                      label="New Password"
                      autoComplete="new-password"
                      minLength={8}
                      {...security.getInputProps("newPassword")}
                    />
                  )}
                  <Text size="xs" c="dimmed">
                    Changing your password signs out your other browser sessions.
                  </Text>
                  {save.error && <Alert color="red">{save.error.message}</Alert>}
                  <Button
                    type="submit"
                    disabled={!securityChanged}
                    loading={save.isPending}
                    style={{ alignSelf: "start" }}
                  >
                    Save Email & Password
                  </Button>
                </Stack>
              </form>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : (
        <Text size="sm" c="dimmed">
          Your email and password are managed by your sign-in provider.
        </Text>
      )}
    </Stack>
  );
}
export function OwnAccount() {
  const account = useQuery(ownAccountQuery);
  if (account.isPending) return <LoadingState label="Loading Your Account" />;
  if (account.error) return <Alert color="red">{account.error.message}</Alert>;
  return (
    <Stack>
      <Accordion transitionDuration={0}>
        <Accordion.Item value="mcp">
          <Accordion.Control>Personal MCP Connection</Accordion.Control>
          <Accordion.Panel>
            <PersonalMcpToken initial={account.data.mcp} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <AccountForm key={account.data.account.id} account={account.data.account} />
    </Stack>
  );
}
