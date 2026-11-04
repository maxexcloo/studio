import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FocusTrap,
  Group,
  Menu,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, Unlink, UserCheck, UserRound, UserX } from "lucide-react";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import type { Account } from "../../types";
import { useAccount } from "../auth/AccountGate";
import { modelsQuery, useGenerationActions } from "../generation/GenerationProvider";
import { isCloudProfile, profileName } from "../generation/payload";
import { ChatGateway, useGatewayChange, type GatewayAccounts } from "./ChatGatewayAccounts";

const featureLabels = {
  chat: "Chat",
  cloudModels: "Cloud Models",
  dream: "Dream",
  loras: "LoRAs",
  uncensoredModels: "Uncensored Models",
};
interface AccessGroup {
  id: string;
  name: string;
  allModels: boolean;
  generationProfiles: string[];
  features: Record<string, boolean>;
}
interface Administration {
  gateway?: GatewayAccounts;
  accounts: Account[];
  accessProfiles: AccessGroup[];
  availableProfiles: string[];
  defaultAccessProfileId: string;
}
function GroupEditor({
  initial,
  admin,
  saved,
  onCancel,
}: {
  initial?: AccessGroup;
  admin: Administration;
  saved: (group: AccessGroup) => void;
  onCancel: () => void;
}) {
  const { profiles } = useGenerationActions();
  const form = useForm<AccessGroup>({
    initialValues: initial || {
      id: "",
      name: "",
      allModels: false,
      generationProfiles: [],
      // As the server reads a group without them (backend/account-policy.js).
      features: { chat: true, dream: true },
    },
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ profile: AccessGroup }>("/api/accounts/profiles", form.values),
    onSuccess: (result) => {
      form.setValues(result.profile);
      saved(result.profile);
    },
  });
  const ids = [...new Set([...admin.availableProfiles, ...form.values.generationProfiles])].filter(
    (id) => {
      const profile = profiles.find((profile) => profile.id === id);
      return !isCloudProfile({ id, family: profile?.family || "", provider: profile?.provider });
    },
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack>
        {/* The ID is fixed once a group exists, so only a new group shows it. */}
        <SimpleGrid cols={{ base: 1, sm: initial ? 1 : 2 }}>
          <TextInput label="Group Name" required {...form.getInputProps("name")} />
          {!initial && (
            <TextInput
              label="Group ID"
              description="Lowercase letters, numbers, colons or hyphens."
              inputWrapperOrder={["label", "input", "description", "error"]}
              required
              {...form.getInputProps("id")}
            />
          )}
        </SimpleGrid>
        <Text size="sm" fw={500}>
          Model Access
        </Text>
        <Checkbox
          label="All Local Models"
          {...form.getInputProps("allModels", { type: "checkbox" })}
        />
        {!form.values.allModels && (
          <MultiSelect
            label="Local Models"
            searchable
            data={ids.map((id) => ({
              value: id,
              label: profileName(profiles.find((profile) => profile.id === id) || { label: id }),
            }))}
            {...form.getInputProps("generationProfiles")}
          />
        )}
        <Text size="sm" fw={500}>
          Permissions
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {Object.entries(featureLabels).map(([feature, label]) => (
            <Checkbox
              key={feature}
              label={label}
              {...form.getInputProps(`features.${feature}`, { type: "checkbox" })}
            />
          ))}
        </SimpleGrid>
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <DialogFooter pending={save.isPending} onCancel={onCancel}>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}
function NewAccount({
  admin,
  saved,
  onCancel,
}: {
  admin: Administration;
  saved: () => void;
  onCancel: () => void;
}) {
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      accessProfileId: admin.defaultAccessProfileId,
    },
  });
  const create = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post("/api/accounts/users", form.values),
    onSuccess: () => {
      form.reset();
      saved();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <Stack>
        <Stack>
          <TextInput
            label="Email"
            type="email"
            autoComplete="off"
            required
            {...form.getInputProps("username")}
          />
          <PasswordInput
            label="Initial Password"
            description="Leave blank for single sign-on only."
            autoComplete="new-password"
            {...form.getInputProps("password")}
          />
          <Select
            label="Access Group"
            data={admin.accessProfiles.map((group) => ({ value: group.id, label: group.name }))}
            required
            allowDeselect={false}
            {...form.getInputProps("accessProfileId")}
          />
        </Stack>
        {create.error && <Alert color="red">{create.error.message}</Alert>}
        <DialogFooter pending={create.isPending} onCancel={onCancel}>
          <Button type="submit" loading={create.isPending}>
            Create User
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}

export const accountAdminQuery = queryOptions({
  queryKey: ["account-admin"],
  queryFn: () => api<Administration>("/api/accounts/admin"),
});
function useAdministration() {
  const client = useQueryClient();
  const admin = useQuery(accountAdminQuery);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: accountAdminQuery.queryKey });
    void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
  };
  return { admin, refresh };
}
const groupFeature = (on: boolean | undefined, label: string) => (
  <Badge miw="max-content" color={on ? "green" : "gray"}>
    {label} {on ? "On" : "Off"}
  </Badge>
);

/** Settings › Groups: what each access group may use. */
export function GroupsAdmin({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const { admin, refresh } = useAdministration();
  const [editing, setEditing] = useState<AccessGroup | "new" | null>(null);
  const [deleting, setDeleting] = useState<AccessGroup | null>(null);
  const remove = useMutation({
    mutationFn: (group: AccessGroup) =>
      api(`/api/accounts/profiles/${encodeURIComponent(group.id)}`, { method: "DELETE" }),
    onSuccess: () => setDeleting(null),
    onSettled: refresh,
  });
  if (admin.isPending) return <LoadingState label="Loading Groups" />;
  if (admin.error) return <Alert color="red">{admin.error.message}</Alert>;
  const data = admin.data;
  const users = (group: AccessGroup) =>
    data.accounts.filter((account) => account.accessProfileId === group.id).length;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Groups"
          actions={
            <ToolbarAction
              label="New Group"
              icon={<Plus size={18} />}
              onClick={() => setEditing("new")}
            />
          }
        />
      </SectionHeader>
      <DataTable
        label="Access Groups"
        rows={data.accessProfiles}
        rowKey={(group) => group.id}
        rowName={(group) => group.name}
        initialSort={{ key: "group", descending: false }}
        empty="No Groups"
        columns={[
          {
            key: "group",
            header: "Group",
            sortValue: (group) => group.name,
            cell: (group) => (
              <>
                <Text size="sm" fw={500}>
                  {group.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {group.allModels
                    ? "All local models"
                    : `${group.generationProfiles.length} local ${group.generationProfiles.length === 1 ? "model" : "models"}`}{" "}
                  · {users(group)} {users(group) === 1 ? "user" : "users"}
                </Text>
              </>
            ),
          },
          {
            key: "permissions",
            header: "Permissions",
            visibleFrom: "sm",
            cell: (group) => (
              <Group gap={4}>
                {groupFeature(group.features.cloudModels, "Cloud Models")}
                {groupFeature(group.features.uncensoredModels, "Uncensored Models")}
                {!group.features.chat && groupFeature(false, "Chat")}
                {!group.features.dream && groupFeature(false, "Dream")}
              </Group>
            ),
          },
        ]}
        rowActions={(group) => (
          <>
            <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => setEditing(group)}>
              Edit Group
            </Menu.Item>
            <Menu.Divider />
            {/* The server refuses too: a group in use or the default stays. */}
            <Menu.Item
              color="red"
              leftSection={<icons.delete size={16} />}
              disabled={users(group) > 0 || group.id === data.defaultAccessProfileId}
              onClick={() => setDeleting(group)}
            >
              Delete Group
            </Menu.Item>
          </>
        )}
      />
      <ConfirmDialog
        opened={!!deleting}
        title="Delete Group"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      >
        Delete {deleting?.name}? Only a group nobody belongs to that isn’t the default can go.
      </ConfirmDialog>
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New Group" : "Edit Group"}
        size="lg"
      >
        <FocusTrap.InitialFocus />
        {editing && (
          <GroupEditor
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            admin={data}
            onCancel={() => setEditing(null)}
            saved={(group) => {
              client.setQueryData<Administration>(accountAdminQuery.queryKey, (previous) =>
                previous
                  ? {
                      ...previous,
                      accessProfiles: [
                        ...previous.accessProfiles.filter((value) => value.id !== group.id),
                        group,
                      ],
                    }
                  : previous,
              );
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

type UserAction = "delete" | "disable" | "password" | "role";

/** Reset Password: an administrator sets a new one, which ends the account's sessions. */
function ResetPassword({
  account,
  saved,
  onCancel,
}: {
  account: Account;
  saved: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api(`/api/accounts/users/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      }),
    onSuccess: saved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        reset.mutate();
      }}
    >
      <Stack>
        <Text size="sm">
          Set a new password for {account.username}. It signs them out everywhere; tell them the new
          one yourself.
        </Text>
        <PasswordInput
          label="New Password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {reset.error && <Alert color="red">{reset.error.message}</Alert>}
        <DialogFooter pending={reset.isPending} onCancel={onCancel}>
          <Button type="submit" loading={reset.isPending} disabled={password.length < 8}>
            Reset Password
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}

/** Settings › Users: accounts, their roles and groups, linked chat identities and the default group. */
export function UsersAdmin({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const self = useAccount().data?.account?.id;
  const { admin, refresh } = useAdministration();
  const gatewayChange = useGatewayChange();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<{ action: UserAction; account: Account } | null>(null);
  // Changes show at once; the saved list (or, after a failure, the refetched one) settles them.
  const optimistic = (apply: (data: Administration) => Administration) => {
    void client.cancelQueries({ queryKey: accountAdminQuery.queryKey });
    client.setQueryData<Administration>(accountAdminQuery.queryKey, (data) => data && apply(data));
  };
  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Account> }) =>
      api(`/api/accounts/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onMutate: ({ id, patch }) =>
      optimistic((data) => ({
        ...data,
        accounts: data.accounts.map((account) =>
          account.id === id ? { ...account, ...patch } : account,
        ),
      })),
    onSuccess: () => setActing(null),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/accounts/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => setActing(null),
    onSettled: refresh,
  });
  const policy = useMutation({
    mutationFn: (accessProfileId: string) =>
      post("/api/accounts/default-profile", { accessProfileId }),
    onMutate: (accessProfileId) =>
      optimistic((data) => ({ ...data, defaultAccessProfileId: accessProfileId })),
    onSettled: refresh,
  });
  if (admin.isPending) return <LoadingState label="Loading Users" />;
  if (admin.error) return <Alert color="red">{admin.error.message}</Alert>;
  const data = admin.data;
  const groups = data.accessProfiles.map((group) => ({ value: group.id, label: group.name }));
  const groupOf = (account: Account) =>
    data.accessProfiles.find((group) => group.id === account.accessProfileId);
  const identitiesOf = (account: Account) =>
    (data.gateway?.links || []).filter((link) => link.accountId === account.id);
  const defaultGroup = data.accessProfiles.find(
    (group) => group.id === data.defaultAccessProfileId,
  );
  const target = acting?.account;
  const promote = target?.role === "user";
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Users"
          query={query}
          onQueryChange={setQuery}
          actions={
            <ToolbarAction
              label="New User"
              icon={<Plus size={18} />}
              onClick={() => setCreating(true)}
            />
          }
        />
      </SectionHeader>
      <DataTable
        label="User Accounts"
        rows={data.accounts}
        rowKey={(account) => account.id}
        rowName={(account) => account.username}
        query={query}
        searchText={(account) => [account.username]}
        initialSort={{ key: "account", descending: false }}
        empty="No Users"
        columns={[
          {
            key: "account",
            header: "Account",
            main: true,
            sortValue: (account) => account.username,
            cell: (account) => (
              <>
                <Text size="sm" fw={500} truncate>
                  {account.username}
                </Text>
                <Group gap={4} mt={4}>
                  {(account.disabled || account.role === "administrator") && (
                    <Badge miw="max-content" color={account.disabled ? "red" : "gray"}>
                      {account.disabled ? "Disabled" : "Administrator"}
                    </Badge>
                  )}
                  {account.signInLinked && (
                    <Badge miw="max-content" color="gray">
                      Single Sign-On
                    </Badge>
                  )}
                  {identitiesOf(account).length > 0 && (
                    <Badge miw="max-content" color="gray">
                      Chat Gateway
                    </Badge>
                  )}
                </Group>
              </>
            ),
          },
          {
            key: "group",
            header: "Access Group",
            sortValue: (account) =>
              account.role === "user" ? groupOf(account)?.name : "All Groups",
            cell: (account) =>
              account.role === "user" ? (
                <Select
                  aria-label={`Access Group for ${account.username}`}
                  size="xs"
                  value={account.accessProfileId || null}
                  placeholder="Choose Group"
                  data={groups}
                  allowDeselect={false}
                  w={{ base: 140, sm: 200 }}
                  onChange={(accessProfileId) =>
                    accessProfileId && change.mutate({ id: account.id, patch: { accessProfileId } })
                  }
                />
              ) : (
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  All Groups
                </Text>
              ),
          },
        ]}
        rowActions={(account) => {
          const act = (action: UserAction) => () => setActing({ action, account });
          const own = account.id === self;
          // Your own role, status and record change only through another administrator.
          if (own && !identitiesOf(account).length && !account.passwordSignIn) return null;
          return (
            <>
              {identitiesOf(account).map(({ identity }) => (
                <Menu.Item
                  key={identity}
                  leftSection={<Unlink size={16} />}
                  disabled={gatewayChange.isPending}
                  onClick={() => gatewayChange.mutate({ kind: "link", identity })}
                >
                  Unlink {identity}
                </Menu.Item>
              ))}
              {!own && (
                <Menu.Item
                  leftSection={
                    account.role === "user" ? <ShieldCheck size={16} /> : <UserRound size={16} />
                  }
                  onClick={act("role")}
                >
                  {account.role === "user" ? "Make Administrator" : "Make User"}
                </Menu.Item>
              )}
              {account.passwordSignIn && (
                <Menu.Item leftSection={<KeyRound size={16} />} onClick={act("password")}>
                  Reset Password
                </Menu.Item>
              )}
              {account.disabled && (
                <Menu.Item
                  leftSection={<UserCheck size={16} />}
                  onClick={() => change.mutate({ id: account.id, patch: { disabled: false } })}
                >
                  Enable User
                </Menu.Item>
              )}
              {!own && (
                <>
                  <Menu.Divider />
                  {!account.disabled && (
                    <Menu.Item
                      color="red"
                      leftSection={<UserX size={16} />}
                      onClick={act("disable")}
                    >
                      Disable User
                    </Menu.Item>
                  )}
                  <Menu.Item
                    color="red"
                    leftSection={<icons.delete size={16} />}
                    onClick={act("delete")}
                  >
                    Delete User
                  </Menu.Item>
                </>
              )}
            </>
          );
        }}
      />
      <ChatGateway gateway={data.gateway} accounts={data.accounts} change={gatewayChange} />
      <SettingGroup title="New Accounts">
        <SettingRow
          wide
          label="Default Group"
          description="New accounts, including first single sign-on and chat gateway accounts, start in this group."
        >
          <Select
            aria-label="Default Group"
            data={groups}
            value={data.defaultAccessProfileId}
            allowDeselect={false}
            w={{ base: "100%", sm: 240 }}
            onChange={(value) => value && policy.mutate(value)}
          />
        </SettingRow>
      </SettingGroup>
      <Modal opened={creating} onClose={() => setCreating(false)} title="New User">
        <FocusTrap.InitialFocus />
        {creating && (
          <NewAccount
            admin={data}
            onCancel={() => setCreating(false)}
            saved={() => {
              setCreating(false);
              refresh();
            }}
          />
        )}
      </Modal>
      <Modal
        opened={acting?.action === "password"}
        onClose={() => setActing(null)}
        title="Reset Password"
      >
        <FocusTrap.InitialFocus />
        {target && acting?.action === "password" && (
          <ResetPassword
            key={target.id}
            account={target}
            saved={() => setActing(null)}
            onCancel={() => setActing(null)}
          />
        )}
      </Modal>
      <ConfirmDialog
        opened={acting?.action === "role"}
        title={promote ? "Make Administrator" : "Make User"}
        action={promote ? "Make Administrator" : "Make User"}
        pending={change.isPending}
        onConfirm={() =>
          target &&
          change.mutate({
            id: target.id,
            patch: { role: promote ? "administrator" : "user" },
          })
        }
        onClose={() => setActing(null)}
      >
        {promote
          ? `Make ${target?.username} an administrator? They can use and change everything, including other accounts.`
          : `Make ${target?.username} an ordinary user? They join ${defaultGroup?.name || "the default group"} and lose administration.`}
      </ConfirmDialog>
      <ConfirmDialog
        opened={acting?.action === "disable"}
        title="Disable User"
        action="Disable"
        pending={change.isPending}
        onConfirm={() => target && change.mutate({ id: target.id, patch: { disabled: true } })}
        onClose={() => setActing(null)}
      >
        Disable {target?.username}? They are signed out everywhere and can’t sign in until you
        enable them again.
      </ConfirmDialog>
      <ConfirmDialog
        opened={acting?.action === "delete"}
        title="Delete User"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => target && remove.mutate(target.id)}
        onClose={() => setActing(null)}
      >
        Delete {target?.username}? Their account, sign-ins and MCP token are removed for good. Their
        images and videos stay on disk but no longer show in Studio.
      </ConfirmDialog>
    </Stack>
  );
}
