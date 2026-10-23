import { SectionHeading } from "../../ui/SectionHeading";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { RuntimePanel } from "../runtime/RuntimePanel";
import { WorkspaceSections, WorkspaceSectionSelect } from "../../ui/WorkspaceSections";
import { OwnAccount } from "./OwnAccount";
import { AccountAdmin } from "./AccountAdmin";
import { useAccount } from "../auth/AccountGate";
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
  const { account, options } = useSettingsNavigation();
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
                  <SectionHeading>Account</SectionHeading>
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
            content: <RuntimePanel />,
          },
          {
            ...settingSections.definitions,
            content: (
              <Paper>
                <Stack>
                  <SectionHeading>Profiles, Guides & Catalogue</SectionHeading>
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
                  <SectionHeading>About Studio</SectionHeading>
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
