import type { ReactNode } from "react";
import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { icons } from "../../ui/icons";
import { RuntimePanel, servicesStatusQuery } from "../runtime/RuntimePanel";
import { runtimeStatusQuery } from "../runtime/RuntimeWorkloads";
import { SectionHeader } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { AboutStudio } from "./AboutStudio";
import { GroupsAdmin, UsersAdmin } from "./AccountAdmin";
import { GenerationSettings } from "./GenerationSettings";
import { IntegrationSettings } from "./IntegrationSettings";
import { OwnAccount } from "./OwnAccount";
import { Preferences } from "./Preferences";
import { useSettingsNavigation } from "./SettingsNavigation";

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
        <Tooltip label="Refresh">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Refresh"
            loading={refreshing}
            onClick={() =>
              workerQueries.forEach((queryKey) => void client.refetchQueries({ queryKey }))
            }
          >
            <icons.refresh size={18} />
          </ActionIcon>
        </Tooltip>
      </SectionHeader>
      <RuntimePanel />
    </Stack>
  );
}
export function SettingsPage() {
  const { multi, options } = useSettingsNavigation();
  return (
    <WorkspaceSections
      label="Settings"
      sections={options}
      content={{
        account: (
          <Stack component="section" aria-label="Your Account" id="account">
            {multi ? (
              <OwnAccount />
            ) : (
              <SettingGroup title="Sign-In">
                <SettingRow
                  label="Single-User Mode"
                  description="No sign-in and every feature on. Accounts, groups and personal MCP access need multi-user mode."
                />
              </SettingGroup>
            )}
          </Stack>
        ),
        preferences: <Preferences />,
        generation: <GenerationSettings />,
        groups: (heading) => <GroupsAdmin heading={heading} />,
        integrations: <IntegrationSettings />,
        users: (heading) => <UsersAdmin heading={heading} />,
        workers: (heading) => <WorkerSettings heading={heading} />,
        about: <AboutStudio />,
      }}
    />
  );
}
