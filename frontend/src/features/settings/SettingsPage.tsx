import { Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { DreamPreferences } from "../dream/DreamSettings";
import { RuntimePanel, servicesStatusQuery } from "../runtime/RuntimePanel";
import { runtimeQueueQuery, runtimeStatusQuery } from "../runtime/RuntimeWorkloads";
import { AboutStudio } from "./AboutStudio";
import { GroupsAdmin, UsersAdmin } from "./AccountAdmin";
import { DreamAdministration } from "./DreamAdministration";
import { OwnAccount } from "./OwnAccount";
import { Preferences } from "./Preferences";
import { useSettingsNavigation } from "./SettingsNavigation";
import { StudioSettings } from "./StudioSettings";
import { UnfinishedItems } from "./UnfinishedItems";
import { WhereWorkRuns } from "./WhereWorkRuns";

const workerQueries = [
  servicesStatusQuery.queryKey,
  runtimeStatusQuery.queryKey,
  runtimeQueueQuery.queryKey,
];
function WorkerSettings({
  heading,
  onOpenUnfinished,
}: {
  heading: ReactNode;
  onOpenUnfinished: () => void;
}) {
  const client = useQueryClient();
  const refreshing =
    useIsFetching({
      predicate: (query) => workerQueries.some((key) => key[0] === query.queryKey[0]),
    }) > 0;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Workers"
          actions={
            <>
              <ToolbarAction
                label="Unfinished Items"
                icon={icons.unfinished}
                variant="default"
                onClick={onOpenUnfinished}
              />
              <ToolbarAction
                label="Refresh"
                icon={icons.refresh}
                iconOnly
                disabled={refreshing}
                onClick={() =>
                  workerQueries.forEach((queryKey) => void client.refetchQueries({ queryKey }))
                }
              />
            </>
          }
        />
      </SectionHeader>
      <RuntimePanel />
    </Stack>
  );
}
export function SettingsPage() {
  const { admin, options } = useSettingsNavigation();
  const [unfinishedOpen, unfinished] = useDisclosure();
  return (
    <>
      <WorkspaceSections
        label="Settings"
        sections={options}
        content={{
          account: <OwnAccount />,
          preferences: <Preferences />,
          "where-work-runs": <WhereWorkRuns />,
          dream: <DreamPreferences />,
          "dream-policy": <DreamAdministration />,
          groups: (heading) => <GroupsAdmin heading={heading} />,
          studio: <StudioSettings />,
          users: (heading) => <UsersAdmin heading={heading} />,
          workers: (heading) => (
            <WorkerSettings heading={heading} onOpenUnfinished={unfinished.open} />
          ),
          about: <AboutStudio />,
        }}
      />
      {admin && <UnfinishedItems opened={unfinishedOpen} onClose={unfinished.close} />}
    </>
  );
}
