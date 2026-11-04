import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  FocusTrap,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import type { Account } from "../../types";
import { ownAccountQuery, useIsAdmin } from "../auth/AccountGate";
import { PersonalMcpToken } from "./PersonalMcpToken";

/** The Email & Password dialog: both need the current password. */
function AccountForm({ account, saved }: { account: Account; saved: () => void }) {
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ownAccountQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["account-admin"] });
      saved();
    },
    onSettled: () => security.setValues({ currentPassword: "", newPassword: "" }),
  });
  const changed = security.values.username !== account.username || !!security.values.newPassword;
  return (
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
            description="Changing your password signs out your other browser sessions."
            autoComplete="new-password"
            minLength={8}
            {...security.getInputProps("newPassword")}
          />
        )}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <Button
          type="submit"
          disabled={!changed}
          loading={save.isPending}
          style={{ alignSelf: "start" }}
        >
          Save Email & Password
        </Button>
      </Stack>
    </form>
  );
}

/** Settings › Account in multi-user mode: sign-in details as rows, then MCP access. */
export function OwnAccount() {
  const account = useQuery(ownAccountQuery);
  const [editing, setEditing] = useState(false);
  const admin = useIsAdmin();
  if (account.isPending) return <LoadingState label="Loading Your Account" />;
  if (account.error) return <Alert color="red">{account.error.message}</Alert>;
  const own = account.data.account;
  const editable = own.canChangeEmail || own.canChangePassword;
  return (
    <Stack gap="lg">
      <SettingGroup title="Sign-In">
        {own.accessProfile && (
          <SettingRow label="Access Group">
            <Text size="sm">{own.accessProfile.name}</Text>
          </SettingRow>
        )}
        <SettingRow
          label="Email & Password"
          description={
            editable ? own.username : `${own.username} · Managed by your sign-in provider.`
          }
        >
          {editable && (
            <Button size="compact-sm" variant="default" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </SettingRow>
        <SettingRow
          label="Role"
          description={
            admin
              ? "Administrators can use and change everything."
              : "Your access group decides which models, cloud models and uncensored content you can use."
          }
        >
          <Badge miw="max-content">{admin ? "Administrator" : "User"}</Badge>
        </SettingRow>
        <SettingRow label="Sign-In Method">
          <Text size="sm">
            {[
              own.canChangePassword && "Password",
              (own.provider === "pocket-id" || own.signInLinked) && "Single Sign-On",
            ]
              .filter(Boolean)
              .join(" & ") || "None"}
          </Text>
        </SettingRow>
      </SettingGroup>
      <PersonalMcpToken initial={account.data.mcp} />
      <Modal opened={editing} onClose={() => setEditing(false)} title="Email & Password">
        <FocusTrap.InitialFocus />
        {editing && <AccountForm key={own.id} account={own} saved={() => setEditing(false)} />}
      </Modal>
    </Stack>
  );
}
