import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";
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
export function SettingsPage() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const account = useAccount();
  const client = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const admin =
    account.data?.mode !== "multi-user" || account.data.account?.role === "administrator";
  const workers = useQuery({
    queryKey: ["workers"],
    queryFn: () => api<{ workers: Worker[] }>("/api/workers"),
    enabled: admin,
  });
  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Settings</Title>
        <Text c="dimmed">Your workspace, connections and account.</Text>
      </div>
      <Paper>
        <Stack>
          <Title order={3}>Appearance</Title>
          <Select
            label="Colour Scheme"
            value={colorScheme}
            onChange={(value) => setColorScheme(value as "dark" | "light" | "auto")}
            data={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "auto", label: "System" },
            ]}
            maw={320}
          />
        </Stack>
      </Paper>
      <Paper component="section" aria-label="Your Account">
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
          {account.data?.mode === "multi-user" && (
            <Button
              variant="default"
              loading={signingOut}
              onClick={() => {
                setSigningOut(true);
                void post("/api/accounts/sign-out")
                  .then(() => {
                    client.clear();
                    window.location.assign("/");
                  })
                  .catch(failure)
                  .finally(() => setSigningOut(false));
              }}
              style={{ alignSelf: "start" }}
            >
              Sign Out
            </Button>
          )}
        </Stack>
      </Paper>
      {admin && account.data?.mode === "multi-user" && <AccountAdmin />}
      {admin && (
        <Paper>
          <Stack>
            <Title order={3}>Workers</Title>
            <Text size="sm" c="dimmed">
              Worker placements and model configuration are owned by the deployment configuration.
              Studio keeps compatible workers warm and waits for the selected backend.
            </Text>
            {workers.error ? (
              <Alert color="red">{workers.error.message}</Alert>
            ) : (
              workers.data?.workers.map((worker) => (
                <Group key={worker.id} justify="space-between">
                  <Stack gap={4}>
                    <Text fw={500}>{worker.label || worker.name || worker.id}</Text>
                    <Text size="sm" c="dimmed">
                      {worker.url}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    {worker.capabilities?.map((capability) => (
                      <Badge key={capability} variant="light">
                        {capability}
                      </Badge>
                    ))}
                  </Group>
                </Group>
              ))
            )}
          </Stack>
        </Paper>
      )}
      <Paper>
        <Stack>
          <Title order={3}>Profiles, Guides & Catalogue</Title>
          <Text size="sm" c="dimmed">
            Definitions are read from Studio’s mounted configuration directory and maintained in ai.
            Saved generation presets remain editable in generation controls.
          </Text>
        </Stack>
      </Paper>
      <Paper>
        <Stack>
          <Title order={3}>About Studio</Title>
          <Text>Studio is an independent hard fork of HEISS UI.</Text>
          <Text size="sm" c="dimmed">
            Includes work from HEISS UI and J-AI Studio under the MIT licence. The MantineHub theme
            includes MIT-licensed work by RubixCube Innovations. Native MCP modules are licensed
            under AGPL-3.0. Licence notices are included with the application source.
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
    </Stack>
  );
}
