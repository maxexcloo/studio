import { Button, Progress, SegmentedControl, Select, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, post } from "../../api";
import { SettingRow } from "../../ui/SettingRows";

type PassScope = "all" | "outdated" | "missing";
/** An administrator's pass over idle gallery work (backend/domain/idle-work.ts). */
interface PassStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  active: boolean;
  blocked?: boolean;
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
  /** The latest pass's scope, which `remaining` counts. */
  scope: PassScope;
  /** Items each scope's pass would take now. */
  scopes: Record<PassScope, number>;
  perMinute: number;
  etaSeconds: number | null;
}
const passQuery = (route: string) =>
  queryOptions({
    queryKey: ["gallery-pass", route],
    queryFn: () => api<PassStatus>(route),
    // Progress moves while a pass runs; otherwise only a new image changes it.
    refetchInterval: (query) =>
      query.state.data?.active || query.state.data?.blocked ? 2_000 : 60_000,
  });

const count = (value: number) => value.toLocaleString();
const eta = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute left";
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};
const stateLabel = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting for Studio to be idle",
  stopped: "Stopped",
  finished: "Finished",
  unavailable: "Unavailable",
};
const scopeLabels: Record<PassScope, string> = {
  all: "All",
  missing: "Missing",
  outdated: "Out of Date",
};

/**
 * A Settings › Studio › Catch Up row that starts or stops a background feature's pass over the
 * gallery at `route` and follows it; with `scopeLabel` it also chooses the pass's scope (All,
 * Missing or Out of Date, the default), and with `ownRoute` whether it covers only the signed-in
 * account's images or every account's.
 */
export function GalleryPass({
  route,
  label,
  description,
  remaining,
  progressLabel,
  scopeLabel,
  ownRoute,
}: {
  route: string;
  label: string;
  description: string;
  /** What the ready count is waiting for, such as "to index". */
  remaining: string;
  progressLabel: string;
  /** The scope selector's accessible name; without it every pass is Out of Date. */
  scopeLabel?: string;
  /** The same pass over the signed-in account's images alone. */
  ownRoute?: string;
}) {
  const client = useQueryClient();
  const [own, setOwn] = useState(false);
  const passRoute = own && ownRoute ? ownRoute : route;
  const query = passQuery(passRoute);
  const status = useQuery(query);
  const [chosen, setChosen] = useState<PassScope>("outdated");
  const change = useMutation({
    mutationFn: (action: "start" | "stop") =>
      post<PassStatus>(
        `${passRoute}/${action}`,
        action === "start" ? { scope: chosen } : undefined,
      ),
    onSuccess: (data) => client.setQueryData(query.queryKey, data),
  });
  const data = status.data;
  // A running pass shows its own scope; otherwise the one to start.
  const scope = data?.active ? data.scope : chosen;
  const progress = data && data.total ? ((data.done + data.failed) / data.total) * 100 : 0;
  const summary = data && [
    data.state === "unavailable" ? `Unavailable: ${data.reason}` : stateLabel[data.state],
    data.state === "ready"
      ? `${count(data.scopes[scope])} ${remaining}`
      : `${count(data.done)} of ${count(data.total)}`,
    data.failed && `${count(data.failed)} failed`,
    data.active && data.perMinute && `${data.perMinute} a minute`,
    data.active && data.etaSeconds !== null && eta(data.etaSeconds),
  ];
  return (
    <SettingRow
      label={label}
      // Beside Whose Images the controls keep their own widths.
      wide={Boolean(scopeLabel) && !ownRoute}
      description={
        <>
          {description}
          {summary && (
            <Text span display="block" size="xs" aria-live="polite">
              {summary.filter(Boolean).join(" · ")}
            </Text>
          )}
        </>
      }
    >
      {data && (data.active || data.state === "stopped") && (
        <Progress size="sm" w={96} value={progress} aria-label={progressLabel} />
      )}
      {ownRoute && (
        <SegmentedControl
          aria-label="Whose Images"
          size="xs"
          data={["Everyone", "Mine"]}
          value={own ? "Mine" : "Everyone"}
          disabled={data?.active}
          onChange={(value) => setOwn(value === "Mine")}
        />
      )}
      {scopeLabel && (
        <Select
          aria-label={scopeLabel}
          size="xs"
          w={190}
          data={(["all", "missing", "outdated"] as const).map((value) => ({
            value,
            label: data
              ? `${scopeLabels[value]} (${count(data.scopes[value])})`
              : scopeLabels[value],
          }))}
          value={scope}
          allowDeselect={false}
          disabled={data?.active}
          onChange={(value) => value && setChosen(value as PassScope)}
        />
      )}
      {data?.active ? (
        <Button
          size="compact-sm"
          variant="default"
          aria-label={`Stop ${label}`}
          loading={change.isPending}
          onClick={() => change.mutate("stop")}
        >
          Stop
        </Button>
      ) : (
        <Button
          size="compact-sm"
          variant="default"
          aria-label={`Catch Up ${label}`}
          loading={change.isPending}
          disabled={!data || data.state === "unavailable" || !data.scopes[scope]}
          onClick={() => change.mutate("start")}
        >
          Catch Up
        </Button>
      )}
    </SettingRow>
  );
}
