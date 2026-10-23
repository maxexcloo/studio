import {
  Accordion,
  Alert,
  Button,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure } from "../../api";
import { PersonalMcpToken, type McpTokenStatus } from "./PersonalMcpToken";
interface Account {
  id: string;
  username: string;
  displayName: string;
  canChangeEmail: boolean;
  canChangePassword: boolean;
  provider: string;
  accessProfile?: { name: string } | null;
}
function AccountForm({ account }: { account: Account }) {
  const client = useQueryClient();
  const name = useForm({ initialValues: { displayName: account.displayName } });
  const security = useForm({
    initialValues: { username: account.username, currentPassword: "", newPassword: "" },
  });
  const save = useMutation({
    mutationFn: (kind: "name" | "security") => {
      const current = security.getValues();
      const changes =
        kind === "name"
          ? name.getValues()
          : {
              ...(current.username !== account.username ? { username: current.username } : {}),
              currentPassword: current.currentPassword,
              ...(current.newPassword ? { newPassword: current.newPassword } : {}),
            };
      return api<{ account: Account }>("/api/accounts/me", {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
    },
    onSuccess: ({ account }, kind) => {
      if (kind === "name") name.setValues({ displayName: account.displayName });
      else security.setValues({ username: account.username, currentPassword: "", newPassword: "" });
      void client.invalidateQueries({ queryKey: ["own-account"] });
      void client.invalidateQueries({ queryKey: ["account-admin"] });
      notifications.show({ message: "Account updated" });
    },
    onError: failure,
    onSettled: (_, __, kind) => {
      if (kind === "security") security.setValues({ currentPassword: "", newPassword: "" });
    },
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate("name");
        }}
      >
        <Stack>
          <TextInput
            label="Display Name"
            autoComplete="name"
            required
            {...name.getInputProps("displayName")}
          />
          <Button type="submit" loading={save.isPending} style={{ alignSelf: "start" }}>
            Save Display Name
          </Button>
        </Stack>
      </form>
      {account.canChangeEmail || account.canChangePassword ? (
        <Accordion transitionDuration={0}>
          <Accordion.Item value="security">
            <Accordion.Control>Email & Password</Accordion.Control>
            <Accordion.Panel>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate("security");
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
  const account = useQuery({
    queryKey: ["own-account"],
    queryFn: () => api<{ account: Account; mcp?: McpTokenStatus }>("/api/accounts/me"),
  });
  if (account.isPending) return <Loader aria-label="Loading Your Account" />;
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
