import { Button, Progress, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanText, Square } from "lucide-react";
import type { ReactNode } from "react";
import { api, post } from "../../api";
import { SettingRow } from "./SettingRows";

/** An administrator's pass over idle gallery work (backend/domain/idle-work.ts). */
export interface PassStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  active: boolean;
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
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

/** A Settings › Maintenance row that starts or stops a pass at `route` and follows it. */
export function GalleryPass({
  route,
  label,
  description,
  remaining,
  progressLabel,
}: {
  route: string;
  label: string;
  description: ReactNode;
  /** What the ready count is waiting for, such as "to index". */
  remaining: string;
  progressLabel: string;
}) {
  const client = useQueryClient();
  const query = passQuery(route);
  const status = useQuery(query);
  const change = useMutation({
    mutationFn: (action: "start" | "stop") => post<PassStatus>(`${route}/${action}`),
    onSuccess: (data) => client.setQueryData(query.queryKey, data),
  });
  const data = status.data;
  const progress = data && data.total ? ((data.done + data.failed) / data.total) * 100 : 0;
  const summary = data && [
    data.state === "unavailable" ? `Unavailable: ${data.reason}` : stateLabel[data.state],
    data.state === "ready"
      ? `${count(data.remaining)} ${remaining}`
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
      {data?.active ? (
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<Square size={16} />}
          loading={change.isPending}
          onClick={() => change.mutate("stop")}
        >
          Stop
        </Button>
      ) : (
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<ScanText size={16} />}
          loading={change.isPending || status.isPending}
          disabled={!data || data.state === "unavailable" || !data.remaining}
          onClick={() => change.mutate("start")}
        >
          Start
        </Button>
      )}
    </SettingRow>
  );
}
