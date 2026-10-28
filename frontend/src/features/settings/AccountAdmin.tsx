import { useState, type ReactNode } from "react";
import {
  ActionIcon,
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
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserCog } from "lucide-react";
import { api, post } from "../../api";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import type { Account } from "../../types";
import { modelsQuery, useGenerationActions } from "../generation/GenerationProvider";
import { isCloudProfile } from "../generation/payload";
import { ChatGatewayAccounts, type GatewayAccounts } from "./ChatGatewayAccounts";
const featureLabels = {
  cloudModels: "Cloud Models",
  gallery: "Gallery",
  imageGeneration: "Image Generation",
  imageReferences: "Image References",
  loras: "LoRAs",
  uncensoredModels: "Uncensored Models",
  presets: "Presets",
  promptAssistant: "Prompt Assistance",
  promptHistory: "Prompt History",
  videoGeneration: "Video Generation",
  videoReferences: "Video References",
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
  requireApproval: boolean;
  lockedFeatures: Record<string, boolean>;
}
function GroupEditor({
  initial,
  admin,
  saved,
}: {
  initial?: AccessGroup;
  admin: Administration;
  saved: (group: AccessGroup) => void;
}) {
  const { profiles } = useGenerationActions();
  const form = useForm<AccessGroup>({
    initialValues: initial || {
      id: "",
      name: "",
      allModels: false,
      generationProfiles: [],
      features: Object.fromEntries(Object.keys(featureLabels).map((feature) => [feature, false])),
    },
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ profile: AccessGroup }>("/api/accounts/profiles", form.values),
    onSuccess: (result) => {
      form.setValues(result.profile);
      saved(result.profile);
      notifications.show({ message: "Access group saved" });
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
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Group Name" required {...form.getInputProps("name")} />
          <TextInput
            label="Group ID"
            description="A stable lowercase name with letters, numbers, colons or hyphens."
            required
            disabled={!!initial}
            {...form.getInputProps("id")}
          />
        </SimpleGrid>
        <Checkbox
          label="All Local Models"
          {...form.getInputProps("allModels", { type: "checkbox" })}
        />
        {!form.values.allModels && (
          <MultiSelect
            label="Local Model Access"
            searchable
            data={ids.map((id) => ({
              value: id,
              label:
                profiles.find((profile) => profile.id === id)?.displayName ||
                profiles.find((profile) => profile.id === id)?.label ||
                id,
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
              disabled={admin.lockedFeatures[feature]}
              description={admin.lockedFeatures[feature] ? "Disabled by the deployment" : undefined}
              {...form.getInputProps(`features.${feature}`, { type: "checkbox" })}
            />
          ))}
        </SimpleGrid>
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <Button type="submit" style={{ alignSelf: "start" }} loading={save.isPending}>
          Save Access Group
        </Button>
      </Stack>
    </form>
  );
}
function NewAccount({ admin, saved }: { admin: Administration; saved: () => void }) {
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
      notifications.show({ message: "User account created" });
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
        <Button type="submit" loading={create.isPending} style={{ alignSelf: "start" }}>
          Create User
        </Button>
      </Stack>
    </form>
  );
}
function DefaultPolicy({ admin, saved }: { admin: Administration; saved: () => void }) {
  const form = useForm({
    initialValues: {
      accessProfileId: admin.defaultAccessProfileId,
      requireApproval: admin.requireApproval,
    },
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post("/api/accounts/default-profile", form.values),
    onSuccess: () => {
      saved();
      notifications.show({ message: "New account policy saved" });
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack>
        <Select
          label="Default Access Group"
          data={admin.accessProfiles.map((group) => ({ value: group.id, label: group.name }))}
          clearable
          {...form.getInputProps("accessProfileId")}
          onChange={(value) => form.setFieldValue("accessProfileId", value || "")}
        />
        <Checkbox
          label="Require Administrator Approval for New Sign-Ins"
          description="Assign a group to approve a pending account."
          {...form.getInputProps("requireApproval", { type: "checkbox" })}
        />
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <Button type="submit" loading={save.isPending} style={{ alignSelf: "start" }}>
          Save New Account Policy
        </Button>
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
  <Badge miw="max-content" variant="light" color={on ? "green" : "gray"}>
    {label} {on ? "On" : "Off"}
  </Badge>
);

/** An icon action in a section toolbar, named by its tooltip. */
function ToolbarAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" color="gray" aria-label={label} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

/** Settings › Groups: what each access group may use. */
export function GroupsAdmin({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const { admin, refresh } = useAdministration();
  const [editing, setEditing] = useState<AccessGroup | "new" | null>(null);
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
              </Group>
            ),
          },
        ]}
        rowActions={(group) => <Menu.Item onClick={() => setEditing(group)}>Edit Group</Menu.Item>}
      />
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New Group" : `Edit ${editing?.name || "Group"}`}
        size="lg"
      >
        <FocusTrap.InitialFocus />
        {editing && (
          <GroupEditor
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            admin={data}
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

/** Settings › Users: accounts, their groups and the new-account policy. */
export function UsersAdmin({ heading }: { heading: ReactNode }) {
  const { admin, refresh } = useAdministration();
  const [query, setQuery] = useState("");
  const [popup, setPopup] = useState<"new" | "policy" | null>(null);
  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api(`/api/accounts/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: refresh,
  });
  if (admin.isPending) return <LoadingState label="Loading Users" />;
  if (admin.error) return <Alert color="red">{admin.error.message}</Alert>;
  const data = admin.data;
  const groupOf = (account: Account) =>
    data.accessProfiles.find((group) => group.id === account.accessProfileId);
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Users"
          query={query}
          onQueryChange={setQuery}
          actions={
            <>
              <ToolbarAction
                label="New Account Policy"
                icon={<UserCog size={18} />}
                onClick={() => setPopup("policy")}
              />
              <ToolbarAction
                label="New User"
                icon={<Plus size={18} />}
                onClick={() => setPopup("new")}
              />
            </>
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
                  {(account.disabled || account.pending || account.role === "administrator") && (
                    <Badge
                      miw="max-content"
                      variant="light"
                      color={account.disabled ? "red" : account.pending ? "yellow" : "gray"}
                    >
                      {account.disabled
                        ? "Disabled"
                        : account.pending
                          ? "Awaiting Approval"
                          : "Administrator"}
                    </Badge>
                  )}
                  {account.signInLinked && (
                    <Badge miw="max-content" variant="light" color="gray">
                      Single Sign-On
                    </Badge>
                  )}
                  {account.role === "user" && groupOf(account) && (
                    <>
                      {groupFeature(groupOf(account)!.features.cloudModels, "Cloud Models")}
                      {groupFeature(
                        groupOf(account)!.features.uncensoredModels,
                        "Uncensored Models",
                      )}
                    </>
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
                  value={account.accessProfileId || null}
                  placeholder="Choose Group"
                  data={data.accessProfiles.map((group) => ({
                    value: group.id,
                    label: group.name,
                  }))}
                  allowDeselect={false}
                  w={{ base: 140, sm: 200 }}
                  onChange={(accessProfileId) =>
                    change.mutate({ id: account.id, patch: { accessProfileId } })
                  }
                />
              ) : (
                <Text size="sm" c="dimmed">
                  All Groups
                </Text>
              ),
          },
        ]}
        rowActions={(account) => (
          <Menu.Item
            color={account.disabled ? undefined : "red"}
            disabled={change.isPending}
            onClick={() =>
              change.mutate({ id: account.id, patch: { disabled: !account.disabled } })
            }
          >
            {account.disabled ? "Enable Account" : "Disable Account"}
          </Menu.Item>
        )}
      />
      <Modal
        opened={popup !== null}
        onClose={() => setPopup(null)}
        title={popup === "policy" ? "New Account Policy" : "New User"}
      >
        <FocusTrap.InitialFocus />
        {popup === "new" && (
          <NewAccount
            admin={data}
            saved={() => {
              setPopup(null);
              refresh();
            }}
          />
        )}
        {popup === "policy" && (
          <DefaultPolicy
            admin={data}
            saved={() => {
              setPopup(null);
              refresh();
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

/** Settings › Chat Gateway: chat identities linked to accounts. */
export function ChatGatewayAdmin() {
  const { admin } = useAdministration();
  if (admin.isPending) return <LoadingState label="Loading Chat Gateway" />;
  if (admin.error) return <Alert color="red">{admin.error.message}</Alert>;
  return <ChatGatewayAccounts gateway={admin.data.gateway} accounts={admin.data.accounts} />;
}
