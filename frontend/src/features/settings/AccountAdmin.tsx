import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";
import { useGenerationActions } from "../generation/GenerationProvider";
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
interface Account {
  id: string;
  username: string;
  displayName: string;
  role: "administrator" | "user";
  accessProfileId?: string;
  disabled: boolean;
  pending?: boolean;
  signInLinked?: boolean;
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
    mutationFn: () => post<{ profile: AccessGroup }>("/api/accounts/profiles", form.values),
    onSuccess: (result) => {
      form.setValues(result.profile);
      saved(result.profile);
      notifications.show({ message: "Access group saved" });
    },
    onError: failure,
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
    mutationFn: () => post("/api/accounts/users", form.values),
    onSuccess: () => {
      form.reset();
      saved();
      notifications.show({ message: "User account created" });
    },
    onError: failure,
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
    mutationFn: () => post("/api/accounts/default-profile", form.values),
    onSuccess: () => {
      saved();
      notifications.show({ message: "New account policy saved" });
    },
    onError: failure,
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
        <Button type="submit" loading={save.isPending} style={{ alignSelf: "start" }}>
          Save New Account Policy
        </Button>
      </Stack>
    </form>
  );
}
export function AccountAdmin() {
  const client = useQueryClient(),
    [selected, setSelected] = useState<string | null>(null);
  const admin = useQuery({
    queryKey: ["account-admin"],
    queryFn: () => api<Administration>("/api/accounts/admin"),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["account-admin"] });
    void client.invalidateQueries({ queryKey: ["models"] });
  };
  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api(`/api/accounts/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: refresh,
    onError: failure,
  });
  if (admin.isPending) return <Loader aria-label="Loading Account Administration" />;
  if (admin.error) return <Alert color="red">{admin.error.message}</Alert>;
  const data = admin.data;
  return (
    <Paper>
      <Stack gap="lg">
        <Table.ScrollContainer minWidth={760}>
          <Table aria-label="User Accounts" verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Account</Table.Th>
                <Table.Th>Role & Status</Table.Th>
                <Table.Th>Access Group</Table.Th>
                <Table.Th>Permissions</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.accounts.map((account) => {
                const group = data.accessProfiles.find(
                  (group) => group.id === account.accessProfileId,
                );
                return (
                  <Table.Tr
                    key={account.id}
                    aria-label={`Account ${account.displayName || account.username}`}
                  >
                    <Table.Td>
                      <Stack gap={2}>
                        <Text fw={500}>{account.displayName || account.username}</Text>
                        <Text size="xs" c="dimmed">
                          {account.username}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap="xs" align="start">
                        <Badge
                          color={account.disabled ? "red" : account.pending ? "yellow" : "gray"}
                        >
                          {account.disabled
                            ? "Disabled"
                            : account.pending
                              ? "Awaiting Approval"
                              : account.role === "administrator"
                                ? "Administrator"
                                : "User"}
                        </Badge>
                        {account.signInLinked && <Badge variant="light">Single Sign-On</Badge>}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {account.role === "user" ? (
                        <Select
                          label={`Access Group for ${account.displayName || account.username}`}
                          value={account.accessProfileId || null}
                          placeholder="Assign a group to approve"
                          data={data.accessProfiles.map((group) => ({
                            value: group.id,
                            label: group.name,
                          }))}
                          allowDeselect={false}
                          miw={180}
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
                      {account.role === "user" ? (
                        <Stack gap="xs" align="start">
                          <Badge
                            variant="light"
                            color={group?.features.cloudModels ? "green" : "gray"}
                          >
                            Cloud Models {group?.features.cloudModels ? "On" : "Off"}
                          </Badge>
                          <Badge
                            variant="light"
                            color={group?.features.nsfwModels ? "green" : "gray"}
                          >
                            NSFW Models {group?.features.nsfwModels ? "On" : "Off"}
                          </Badge>
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">
                          All Permissions
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color={account.disabled ? "green" : "red"}
                        loading={change.isPending}
                        onClick={() =>
                          change.mutate({ id: account.id, patch: { disabled: !account.disabled } })
                        }
                      >
                        {account.disabled ? "Enable Account" : "Disable Account"}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Accordion variant="separated" transitionDuration={0}>
          <Accordion.Item value="groups">
            <Accordion.Control>Access Groups</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <Select
                  label="Edit Access Group"
                  placeholder="Create a new group"
                  clearable
                  data={data.accessProfiles.map((group) => ({
                    value: group.id,
                    label: group.name,
                  }))}
                  value={selected}
                  onChange={setSelected}
                />
                <GroupEditor
                  key={selected || "new"}
                  initial={data.accessProfiles.find((group) => group.id === selected)}
                  admin={data}
                  saved={(group) => {
                    client.setQueryData<Administration>(["account-admin"], (previous) =>
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
                    setSelected(group.id);
                    refresh();
                  }}
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="gateway">
            <Accordion.Control>Chat Gateway</Accordion.Control>
            <Accordion.Panel>
              <ChatGatewayAccounts gateway={data.gateway} accounts={data.accounts} />
            </Accordion.Panel>
          </Accordion.Item>
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
        </Accordion>
      </Stack>
    </Paper>
  );
}
