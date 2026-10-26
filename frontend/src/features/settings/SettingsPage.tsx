import { Badge, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { RuntimePanel, servicesStatusQuery } from "../runtime/RuntimePanel";
import { runtimeStatusQuery } from "../runtime/RuntimeWorkloads";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { TasteProfile } from "../taste/TasteProfile";
import { AboutStudio } from "./AboutStudio";
import { GroupsAdmin, UsersAdmin } from "./AccountAdmin";
import { MaintenanceSettings } from "./MaintenanceSettings";
import { ModelSettings } from "./ModelSettings";
import { OwnAccount } from "./OwnAccount";
import { ProfileDefinitions } from "./ProfileDefinitions";
import { useSettingsNavigation } from "./SettingsNavigation";
import { StudioPreferences } from "./StudioPreferences";

const workerQueries = [servicesStatusQuery.queryKey, runtimeStatusQuery.queryKey];
function WorkerSettings() {
  const client = useQueryClient();
  const refreshing =
    useIsFetching({
      predicate: (query) => workerQueries.some((key) => key[0] === query.queryKey[0]),
    }) > 0;
  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Tooltip label="Check every service again">
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<RefreshCw size={16} />}
            loading={refreshing}
            onClick={() =>
              workerQueries.forEach((queryKey) => void client.refetchQueries({ queryKey }))
            }
          >
            Refresh
          </Button>
        </Tooltip>
      </Group>
      <RuntimePanel />
    </Stack>
  );
}
export function SettingsPage() {
  const { admin, multi, options } = useSettingsNavigation();
  return (
    <WorkspaceSections
      label="Settings"
      sections={options}
      content={{
        account: (
          <Stack component="section" aria-label="Your Account" id="account">
            <Group gap="xs">
              <Badge variant="light">
                {multi ? (admin ? "Administrator" : "User") : "Single-User Mode"}
              </Badge>
            </Group>
            {multi ? (
              <>
                {!admin && (
                  <Text size="sm" c="dimmed">
                    Your access group decides which models, cloud models and NSFW content you can
                    use.
                  </Text>
                )}
                <OwnAccount />
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Studio is running for one person on this computer, so there is no sign-in and every
                feature is available. Accounts, groups and personal MCP access come with multi-user
                mode.
              </Text>
            )}
            <TasteProfile />
          </Stack>
        ),
        groups: <GroupsAdmin />,
        models: <ModelSettings />,
        profiles: <ProfileDefinitions />,
        studio: <StudioPreferences />,
        users: <UsersAdmin />,
        workers: <WorkerSettings />,
        maintenance: <MaintenanceSettings />,
        about: <AboutStudio />,
      }}
    />
  );
}
