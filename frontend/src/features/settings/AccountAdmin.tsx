import { useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Plus } from "lucide-react";
import { api, post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SectionToolbar } from "../../ui/SectionToolbar";
import type { Account } from "../../types";
import { modelsQuery, useGenerationActions } from "../generation/GenerationProvider";
import { ChatGatewayAccounts, type GatewayAccounts } from "./ChatGatewayAccounts";
const featureLabels = {
  cloudModels: "Cloud Models",
  gallery: "Gallery",
  imageGeneration: "Image Generation",
  imageReferences: "Image References",
  loras: "LoRAs",
  nsfwModels: "NSFW Models",
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
      return (
        profile?.provider !== "cliproxyapi" && profile?.family !== "grok" && !/^grok/i.test(id)
      );
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
      displayName: "",
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
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Email"
            type="email"
            autoComplete="off"
            required
            {...form.getInputProps("username")}
          />
          <TextInput
            label="Display Name"
            autoComplete="off"
            required
            {...form.getInputProps("displayName")}
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
        </SimpleGrid>
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
const accountAdminQuery = queryOptions({
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
  <Badge miw="max-content" variant="light" size="sm" color={on ? "green" : "gray"}>
    {label} {on ? "On" : "Off"}
  </Badge>
);

/** Settings › Groups: what each access group may use. */
export function GroupsAdmin() {
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
      <SectionToolbar
        label="Groups"
        actions={
          <Tooltip label="New Group">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="New Group"
              onClick={() => setEditing("new")}
            >
              <Plus size={18} />
            </ActionIcon>
          </Tooltip>
        }
      />
      {data.accessProfiles.length ? (
        <Table aria-label="Access Groups" verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Group</Table.Th>
              <Table.Th visibleFrom="sm">Permissions</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.accessProfiles.map((group) => (
              <Table.Tr key={group.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {group.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {group.allModels
                      ? "All local models"
                      : `${group.generationProfiles.length} local ${group.generationProfiles.length === 1 ? "model" : "models"}`}{" "}
                    · {users(group)} {users(group) === 1 ? "user" : "users"}
                  </Text>
                </Table.Td>
                <Table.Td visibleFrom="sm">
                  <Group gap={4}>
                    {groupFeature(group.features.cloudModels, "Cloud Models")}
                    {groupFeature(group.features.nsfwModels, "NSFW Models")}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Actions for ${group.name}`}
                      >
                        <Ellipsis size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setEditing(group)}>Edit Group</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <EmptyState title="No Groups">
          Create a group to choose which models and features its users may use.
        </EmptyState>
      )}
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New Group" : `Edit ${editing?.name || "Group"}`}
        size="lg"
      >
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

/** Settings › Users: accounts, their groups, chat identities and the new-account policy. */
export function UsersAdmin() {
  const { admin, refresh } = useAdministration();
  const [query, setQuery] = useState("");
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
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const accounts = data.accounts.filter((account) =>
    terms.every((term) =>
      `${account.displayName} ${account.username}`.toLowerCase().includes(term),
    ),
  );
  return (
    <Stack gap="lg">
      <SectionToolbar label="Users" query={query} onQueryChange={setQuery} />
      {accounts.length ? (
        <Table aria-label="User Accounts" verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Account</Table.Th>
              <Table.Th>Access Group</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {accounts.map((account) => {
              const name = account.displayName || account.username;
              const group = data.accessProfiles.find(
                (group) => group.id === account.accessProfileId,
              );
              return (
                <Table.Tr key={account.id} aria-label={`Account ${name}`}>
                  <Table.Td maw={0} w="100%">
                    <Text size="sm" fw={500} truncate>
                      {name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {account.username}
                    </Text>
                    <Group gap={4} mt={4}>
                      {(account.disabled ||
                        account.pending ||
                        account.role === "administrator") && (
                        <Badge
                          miw="max-content"
                          size="sm"
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
                        <Badge miw="max-content" size="sm" variant="light" color="gray">
                          Single Sign-On
                        </Badge>
                      )}
                      {account.role === "user" && group && (
                        <>
                          {groupFeature(group.features.cloudModels, "Cloud Models")}
                          {groupFeature(group.features.nsfwModels, "NSFW Models")}
                        </>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {account.role === "user" ? (
                      <Select
                        aria-label={`Access Group for ${name}`}
                        value={account.accessProfileId || null}
                        placeholder="Choose Group"
                        data={data.accessProfiles.map((group) => ({
                          value: group.id,
                          label: group.name,
                        }))}
                        allowDeselect={false}
                        size="sm"
                        w={{ base: 140, sm: 200 }}
                        onChange={(accessProfileId) =>
                          change.mutate({ id: account.id, patch: { accessProfileId } })
                        }
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        All Groups
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Actions for ${name}`}
                        >
                          <Ellipsis size={18} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          color={account.disabled ? undefined : "red"}
                          disabled={change.isPending}
                          onClick={() =>
                            change.mutate({
                              id: account.id,
                              patch: { disabled: !account.disabled },
                            })
                          }
                        >
                          {account.disabled ? "Enable Account" : "Disable Account"}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      ) : (
        <EmptyState title="No Matching Users">Try another name or email.</EmptyState>
      )}
      {/* Opening without a height animation keeps nested Select dropdowns anchored to their inputs. */}
      <Accordion variant="separated" transitionDuration={0}>
        <Accordion.Item value="new-user">
          <Accordion.Control>Create a User</Accordion.Control>
          <Accordion.Panel>
            <NewAccount admin={data} saved={refresh} />
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="defaults">
          <Accordion.Control>New Account Policy</Accordion.Control>
          <Accordion.Panel>
            <DefaultPolicy
              key={`${data.defaultAccessProfileId}:${data.requireApproval}`}
              admin={data}
              saved={refresh}
            />
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="gateway">
          <Accordion.Control>Chat Gateway</Accordion.Control>
          <Accordion.Panel>
            <ChatGatewayAccounts gateway={data.gateway} accounts={data.accounts} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
