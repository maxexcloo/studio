import { Alert, Badge, Button, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { WorkspaceSections, WorkspaceSectionSelect } from "../../ui/WorkspaceSections";
import { OwnAccount } from "./OwnAccount";
import { AccountAdmin } from "./AccountAdmin";
import { useAccount } from "../auth/AccountGate";
interface Worker {
  id: string;
  name?: string;
  label?: string;
  url?: string;
  capabilities?: string[];
}
const settingSections = {
  account: { value: "account", label: "Account" },
  accounts: { value: "accounts", label: "Accounts" },
  workers: { value: "workers", label: "Workers" },
  definitions: { value: "definitions", label: "Definitions" },
  about: { value: "about", label: "About" },
};
function useSettingsNavigation() {
  const account = useAccount();
  const admin =
    account.data?.mode !== "multi-user" || account.data.account?.role === "administrator";
  const options = [
    settingSections.account,
    ...(admin && account.data?.mode === "multi-user" ? [settingSections.accounts] : []),
    ...(admin ? [settingSections.workers] : []),
    settingSections.definitions,
    settingSections.about,
  ];
  return { account, admin, options };
}
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
export function SettingsPage() {
  const { account, admin, options } = useSettingsNavigation();
  const workers = useQuery({
    queryKey: ["workers"],
    queryFn: () => api<{ workers: Worker[] }>("/api/workers"),
    enabled: admin,
  });
  return (
    <Stack gap="xl">
      <WorkspaceSections
        label="Settings"
        sections={[
          {
            ...settingSections.account,
            content: (
              <Paper component="section" aria-label="Your Account" id="account">
                <Stack>
                  <Title order={3}>Account</Title>
                  <Group>
                    <Badge>
                      {account.data?.mode === "multi-user"
                        ? account.data.account?.role === "administrator"
                          ? "Administrator"
                          : "User"
                        : "Single-User Development"}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Cloud model and NSFW permissions are enforced by Studio for your account.
                  </Text>
                  {account.data?.mode === "multi-user" && <OwnAccount />}
                </Stack>
              </Paper>
            ),
          },
          { ...settingSections.accounts, content: <AccountAdmin /> },
          {
            ...settingSections.workers,
            content: (
              <Paper>
                <Stack>
                  <Title order={3}>Workers</Title>
                  <Text size="sm" c="dimmed">
                    Worker placements and model configuration are owned by the deployment
                    configuration. Studio keeps compatible workers warm and waits for the selected
                    backend.
                  </Text>
                  {workers.isPending ? (
                    <LoadingState label="Loading Workers" />
                  ) : workers.error ? (
                    <Alert color="red">{workers.error.message}</Alert>
                  ) : workers.data?.workers.length ? (
                    <Table.ScrollContainer minWidth={540}>
                      <Table aria-label="Configured Workers" verticalSpacing="sm" highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Worker</Table.Th>
                            <Table.Th>Address</Table.Th>
                            <Table.Th>Capabilities</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {workers.data.workers.map((worker) => (
                            <Table.Tr key={worker.id}>
                              <Table.Td>
                                <Text fw={500}>{worker.label || worker.name || worker.id}</Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {worker.url}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap="xs">
                                  {worker.capabilities?.map((capability) => (
                                    <Badge key={capability} variant="light">
                                      {capability}
                                    </Badge>
                                  ))}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  ) : (
                    <Text c="dimmed" size="sm">
                      No workers are configured.
                    </Text>
                  )}
                </Stack>
              </Paper>
            ),
          },
          {
            ...settingSections.definitions,
            content: (
              <Paper>
                <Stack>
                  <Title order={3}>Profiles, Guides & Catalogue</Title>
                  <Text size="sm" c="dimmed">
                    Definitions are read from Studio’s mounted configuration directory and
                    maintained in ai. Saved generation presets remain editable in generation
                    controls.
                  </Text>
                </Stack>
              </Paper>
            ),
          },
          {
            ...settingSections.about,
            content: (
              <Paper>
                <Stack>
                  <Title order={3}>About Studio</Title>
                  <Text>Studio is an independent hard fork of HEISS UI.</Text>
                  <Text size="sm" c="dimmed">
                    Includes work from HEISS UI and J-AI Studio under the MIT licence. The
                    MantineHub theme includes MIT-licensed work by RubixCube Innovations. Native MCP
                    modules are licensed under AGPL-3.0. Licence notices are included with the
                    application source.
                  </Text>
                  <Button
                    component="a"
                    href="https://github.com/maxexcloo/studio"
                    variant="subtle"
                    style={{ alignSelf: "start" }}
                  >
                    Source & Licences
                  </Button>
                </Stack>
              </Paper>
            ),
          },
        ].filter((section) => options.some((option) => option.value === section.value))}
      />
    </Stack>
  );
}
