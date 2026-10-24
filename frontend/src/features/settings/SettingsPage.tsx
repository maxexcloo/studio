import { useSettingsNavigation } from "./SettingsNavigation";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { RuntimePanel } from "../runtime/RuntimePanel";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { OwnAccount } from "./OwnAccount";
import { AccountAdmin } from "./AccountAdmin";
export function SettingsPage() {
  const { account, options } = useSettingsNavigation();
  return (
    <WorkspaceSections
      label="Settings"
      sections={options}
      content={{
        account: (
          <Paper component="section" aria-label="Your Account" id="account">
            <Stack>
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
        accounts: <AccountAdmin />,
        workers: <RuntimePanel />,
        about: (
          <Paper>
            <Stack>
              <Text>Studio is an independent hard fork of HEISS UI.</Text>
              <Text size="sm" c="dimmed">
                Includes work from HEISS UI and J-AI Studio under the MIT licence. The MantineHub
                theme includes MIT-licensed work by RubixCube Innovations. Native MCP modules are
                licensed under AGPL-3.0. Licence notices are included with the application source.
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
      }}
    />
  );
}
