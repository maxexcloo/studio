import type { ReactNode } from "react";
import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { RuntimePanel, servicesStatusQuery } from "../runtime/RuntimePanel";
import { runtimeStatusQuery } from "../runtime/RuntimeWorkloads";
import { SectionHeader } from "../../ui/SectionToolbar";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { TasteProfile } from "../taste/TasteProfile";
import { AboutStudio } from "./AboutStudio";
import { ChatGatewayAdmin, GroupsAdmin, UsersAdmin } from "./AccountAdmin";
import { MaintenanceSettings } from "./MaintenanceSettings";
import { ModelSettings } from "./ModelSettings";
import { OwnAccount } from "./OwnAccount";
import { ProfileDefinitions } from "./ProfileDefinitions";
import { useSettingsNavigation } from "./SettingsNavigation";
import { StudioPreferences } from "./StudioPreferences";

const workerQueries = [servicesStatusQuery.queryKey, runtimeStatusQuery.queryKey];
function WorkerSettings({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const refreshing =
    useIsFetching({
      predicate: (query) => workerQueries.some((key) => key[0] === query.queryKey[0]),
    }) > 0;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <Tooltip label="Check Every Service Again">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Refresh"
            loading={refreshing}
            onClick={() =>
              workerQueries.forEach((queryKey) => void client.refetchQueries({ queryKey }))
            }
          >
            <RefreshCw size={18} />
          </ActionIcon>
        </Tooltip>
      </SectionHeader>
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
                    Your access group decides which models, cloud models and uncensored content you
                    can use.
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
        gateway: <ChatGatewayAdmin />,
        groups: (heading) => <GroupsAdmin heading={heading} />,
        maintenance: <MaintenanceSettings />,
        models: <ModelSettings />,
        profiles: (heading) => <ProfileDefinitions heading={heading} />,
        studio: <StudioPreferences />,
        users: (heading) => <UsersAdmin heading={heading} />,
        workers: (heading) => <WorkerSettings heading={heading} />,
        about: <AboutStudio />,
      }}
    />
  );
}
