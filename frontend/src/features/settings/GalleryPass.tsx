import { useState, type ReactNode } from "react";
import { Button, Progress, Select, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanText, Square } from "lucide-react";
import { api, post } from "../../api";
import { SettingRow } from "./SettingRows";

type PassScope = "all" | "outdated" | "missing";
/** An administrator's pass over idle gallery work (backend/domain/idle-work.ts). */
export interface PassStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  active: boolean;
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
    refetchInterval: (query) => (query.state.data?.active ? 2_000 : 60_000),
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
 * A Settings › Maintenance row that starts or stops a pass at `route` and follows it; with
 * `scopeLabel` it also chooses the pass's scope (All, Missing or Out of Date, the default).
 */
export function GalleryPass({
  route,
  label,
  description,
  remaining,
  progressLabel,
  scopeLabel,
}: {
  route: string;
  label: string;
  description: ReactNode;
  /** What the ready count is waiting for, such as "to index". */
  remaining: string;
  progressLabel: string;
  /** The scope selector's accessible name; without it every pass is Out of Date. */
  scopeLabel?: string;
}) {
  const client = useQueryClient();
  const query = passQuery(route);
  const status = useQuery(query);
  const [chosen, setChosen] = useState<PassScope>("outdated");
  const change = useMutation({
    mutationFn: (action: "start" | "stop") =>
      post<PassStatus>(`${route}/${action}`, action === "start" ? { scope: chosen } : undefined),
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
      {scopeLabel && (
        <Select
          aria-label={scopeLabel}
          w={150}
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
          variant="default"
          leftSection={<Square size={16} />}
          loading={change.isPending}
          onClick={() => change.mutate("stop")}
        >
          Stop
        </Button>
      ) : (
        <Button
          variant="default"
          leftSection={<ScanText size={16} />}
          loading={change.isPending}
          disabled={!data || data.state === "unavailable" || !data.scopes[scope]}
          onClick={() => change.mutate("start")}
        >
          Start
        </Button>
      )}
    </SettingRow>
  );
}
