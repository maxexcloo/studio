import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Loader,
  Menu,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  type RuntimeOperation,
  type RuntimePreview,
  type RuntimeQueueCancel,
  type RuntimeQueueStatus,
  type RuntimeStatus,
  type WorkloadPhase,
  activeBenchmark,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable, HistoryTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { SettingGroup } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";
import { useSettingsSection } from "../settings/SettingsNavigation";
import { BenchmarkDialog, benchmarksQuery } from "./Benchmarks";
import { LogDialog, LogText, PodLog, logTime, useRequester } from "./RuntimeLogs";

export const runtimeStatusQuery = queryOptions({
  queryKey: ["runtime-status"],
  queryFn: () => api<RuntimeStatus>("/api/runtime"),
  // Follow a running change closely; otherwise refresh with the service status.
  refetchInterval: (query) => (query.state.data?.operation ? 2000 : 15000),
});
export const runtimeQueueQuery = queryOptions({
  queryKey: ["runtime-queue"],
  queryFn: () => api<RuntimeQueueStatus>("/api/runtime/queue"),
  refetchInterval: ({ state }) =>
    Object.values(state.data?.workloads ?? {}).some(({ jobs, queued }) => jobs.length || queued)
      ? 2000
      : 15000,
});
/** Applies a previewed placement; the signature proves nothing changed since the preview. */
export const applyPlacement = (plan: RuntimePreview) =>
  post<RuntimeOperation>("/api/runtime/apply", {
    workloads: plan.target,
    signature: plan.signature,
  });

/** What a previewed placement stops, starts and keeps, for its confirmation. */
export function PlacementChanges({
  preview,
  label,
}: {
  preview: RuntimePreview;
  label: (id: string) => string;
}) {
  const names = (ids: string[]) => (ids.length ? ids.map(label).join(", ") : "None");
  return (
    <Stack gap={4}>
      <Text size="sm">Stop: {names(preview.stop)}</Text>
      <Text size="sm">Start: {names(preview.start)}</Text>
      <Text size="sm">Keep: {names(preview.keep)}</Text>
      <Text size="xs" c="dimmed">
        Accepted work on the stopping workloads finishes and saves first.
      </Text>
    </Stack>
  );
}

const phaseColour = (phase: WorkloadPhase) =>
  ({
    running: "green",
    starting: "yellow",
    stopping: "yellow",
    parked: "gray",
    down: "red",
    unknown: "red",
  })[phase];
const phaseLabel = (phase: WorkloadPhase) =>
  ({
    running: "Running",
    starting: "Starting",
    stopping: "Stopping",
    parked: "Stopped",
    down: "Down",
    unknown: "Unknown",
  })[phase];
const operationColour = (status: RuntimeOperation["status"]) =>
  ({ running: "blue", completed: "green", failed: "red", interrupted: "yellow" })[status];
const operationLabel = (status: RuntimeOperation["status"]) =>
  ({ running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" })[
    status
  ];
const holding = (phase: WorkloadPhase) => phase === "running" || phase === "starting";
const unfinished = (entry?: RuntimeOperation) =>
  entry?.status === "failed" || entry?.status === "interrupted" ? entry : undefined;

/**
 * Where a workload stands in a change: while one runs, the step each affected workload is in (a
 * stopped one waiting to start already reads Starting); after one that didn't finish, the
 * workloads it left short of their target.
 */
function changePhase(
  id: string,
  phase: WorkloadPhase,
  operation?: RuntimeOperation,
  failed?: RuntimeOperation,
): { pending?: WorkloadPhase; failed?: string } {
  if (operation) {
    if (phase === "starting" || phase === "stopping") return { pending: phase };
    if (operation.start.includes(id) && phase !== "running") return { pending: "starting" };
    if (operation.stop.includes(id) && !operation.start.includes(id) && phase === "running")
      return { pending: "stopping" };
  } else if (failed) {
    if (failed.start.includes(id) && phase !== "running") return { failed: "Couldn't start." };
    if (failed.stop.includes(id) && !failed.start.includes(id) && holding(phase))
      return { failed: "Couldn't stop." };
  }
  return {};
}

const shortDateTime = dateFormat({ dateStyle: "short", timeStyle: "short" });

/** A change's steps as timestamped lines, then how it ended once it has. */
function logText(entry: RuntimeOperation) {
  const time = (at: string) => logTime.format(new Date(at));
  return [
    ...entry.steps.map((step) => `${time(step.at)}  ${step.message}`),
    ...(entry.finishedAt ? [`${time(entry.finishedAt)}  ${entry.error || entry.progress}`] : []),
  ].join("\n");
}

/** Workload ids as their names, "None" for none. */
const workloadNames = (workloads: RuntimeStatus["workloads"]) => (ids: string[]) =>
  ids.length
    ? ids.map((id) => workloads.find((item) => item.id === id)?.label ?? id).join(", ")
    : "None";
/** What a change did, as "Before → After" or "Restart X". */
const changeLine = (names: (ids: string[]) => string) => (entry: RuntimeOperation) =>
  entry.type === "restart"
    ? `Restart ${names(entry.start)}`
    : `${names(entry.before)} → ${names(entry.after ?? entry.target)}`;

/** A change's one-line summary: what it did, how it ended, who asked and when. */
const changeSummary = (
  entry: RuntimeOperation,
  change: (entry: RuntimeOperation) => string,
  who: (requestedBy: string) => string,
) =>
  `${change(entry)} · ${operationLabel(entry.status)} · ${who(entry.requestedBy)} · ${shortDateTime.format(new Date(entry.startedAt))}`;

/** A runtime change's log: its steps, then the pods of each workload it started. */
function OperationLog({
  entry,
  change,
  workloads,
  onClose,
}: {
  entry?: RuntimeOperation;
  change: (entry: RuntimeOperation) => string;
  workloads: RuntimeStatus["workloads"];
  onClose: () => void;
}) {
  const who = useRequester();
  const started = [...new Set([...(entry?.start ?? []), ...(entry?.after ?? [])])];
  return (
    <LogDialog
      title="Runtime Log"
      opened={Boolean(entry)}
      onClose={onClose}
      parts={
        entry
          ? [
              {
                value: "steps",
                label: "Steps",
                content: (
                  <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                      {changeSummary(entry, change, who)}
                    </Text>
                    <LogText
                      text={logText(entry)}
                      empty="No steps recorded."
                      label="Change Steps"
                    />
                  </Stack>
                ),
              },
              ...started.map((id) => ({
                value: id,
                label: workloadNames(workloads)([id]),
                content: <PodLog path={`/api/runtime/workloads/${encodeURIComponent(id)}/logs`} />,
              })),
            ]
          : []
      }
    />
  );
}

/** A workload's log: Changes, the steps of every change that touched it; and its pods' tail. */
function WorkloadLog({
  workload,
  history,
  change,
  onClose,
}: {
  workload?: { id: string; label: string };
  history: RuntimeOperation[];
  change: (entry: RuntimeOperation) => string;
  onClose: () => void;
}) {
  const who = useRequester();
  const id = workload?.id ?? "";
  const changes = history
    .filter((entry) => entry.stop.includes(id) || entry.start.includes(id))
    .reverse()
    .map((entry) => `# ${changeSummary(entry, change, who)}\n${logText(entry)}`)
    .join("\n\n");
  return (
    <LogDialog
      title={`${workload?.label ?? ""} Log`}
      opened={Boolean(workload)}
      onClose={onClose}
      initial="pod"
      parts={[
        {
          value: "changes",
          label: "Changes",
          content: <LogText text={changes} empty="No changes recorded." label="Change Steps" />,
        },
        {
          value: "pod",
          label: "Pod",
          content: workload && (
            <PodLog path={`/api/runtime/workloads/${encodeURIComponent(id)}/logs`} />
          ),
        },
      ]}
    />
  );
}
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** One feasible placement per GPU count, in configured workload order within each pool. */
function gpuPresets({ workloads, pools }: RuntimeStatus) {
  return [
    { label: "ComfyUI", radiance: false },
    { label: "Radiance", radiance: true },
  ].flatMap(({ label, radiance }) => {
    const empty = pools.map(() => 0);
    const combinations = new Map([[empty.join(","), { used: empty, target: [] as string[] }]]);
    for (const workload of workloads.filter((item) => Boolean(item.radiance) === radiance)) {
      const pool = pools.findIndex(({ id }) => id === workload.pool);
      for (const { used, target } of [...combinations.values()]) {
        const next = used.map((gpus, index) => (index === pool ? gpus + workload.gpus : gpus));
        const key = next.join(",");
        if (next[pool] <= pools[pool]?.capacity && !combinations.has(key))
          combinations.set(key, { used: next, target: [...target, workload.id] });
      }
    }
    const counts = new Map<number, string[]>();
    for (const { used, target } of combinations.values()) {
      const count = used.reduce((sum, gpus) => sum + gpus, 0);
      if (count && !counts.has(count)) counts.set(count, target);
    }
    return [...counts]
      .sort(([a], [b]) => a - b)
      .map(([count, target]) => ({
        label: `${label} · ${plural(count, "GPU")}`,
        value: target.join(","),
        target,
      }));
  });
}

/** Settings › Workers: which GPU deployments run, a previewed switch and restarts. */
export function RuntimeWorkloads({
  reasons,
  workerStatus,
}: {
  reasons: Record<string, string>;
  workerStatus?: ReactNode;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const active = useSettingsSection() === "workers";
  const status = useQuery(runtimeStatusQuery);
  const live = useQuery({ ...runtimeQueueQuery, enabled: active && status.isSuccess });
  const [selection, setSelection] = useState<string[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [preview, setPreview] = useState<RuntimePreview | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState("");
  const [queueId, setQueueId] = useState("");
  const [logId, setLogId] = useState("");
  const [workloadLogId, setWorkloadLogId] = useState("");
  const [benchmarkId, setBenchmarkId] = useState("");
  const benchmarks = useQuery(benchmarksQuery).data;
  const benchmarking = benchmarks?.runs.some(activeBenchmark);
  const refresh = () =>
    Promise.all(
      [runtimeStatusQuery, runtimeQueueQuery].map(({ queryKey }) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  const previewing = useMutation({
    mutationFn: (workloads: string[]) =>
      post<RuntimePreview>("/api/runtime/preview", { workloads }),
    onSuccess: setPreview,
  });
  // Start one stopped workload beside what runs, making room as a profile's start does.
  const starting = useMutation({
    mutationFn: (workload: string) =>
      post<RuntimePreview>("/api/runtime/preview", { start: [workload] }),
    onSuccess: setPreview,
  });
  const applying = useMutation({
    mutationFn: applyPlacement,
    meta: { inlineError: true },
    onSuccess: () => {
      setPreview(null);
      setSelection(null);
      setCustom(false);
      void refresh();
    },
  });
  // Radiance restarts without waiting for its accepted work, which ends.
  const restart = useMutation({
    mutationFn: ({ id, radiance }: { id: string; radiance?: true }) =>
      post<RuntimeOperation>("/api/runtime/restart", { workload: id, force: radiance === true }),
    meta: { inlineError: true },
    onSuccess: () => {
      setRestarting(null);
      void refresh();
    },
  });
  const cancelQueue = useMutation({
    mutationFn: (id: string) =>
      post<RuntimeQueueCancel>(`/api/runtime/workloads/${encodeURIComponent(id)}/cancel-queue`, {}),
    meta: { inlineError: true },
    onSuccess: () => {
      setQueueId("");
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => post<RuntimeOperation>(`/api/runtime/operations/${id}/cancel`, {}),
    meta: { inlineError: true },
    onSuccess: () => {
      setCancelling("");
      void refresh();
    },
  });
  const placement = (picker?: ReactNode) =>
    (workerStatus || picker) && (
      <Flex
        component="section"
        aria-label="Placement"
        direction={phone ? "column" : "row"}
        align={phone ? "stretch" : "center"}
        justify="flex-end"
        gap="xs"
      >
        {workerStatus && (
          <Box flex={1} miw={0}>
            {workerStatus}
          </Box>
        )}
        {picker}
      </Flex>
    );
  if (status.isPending || status.error)
    return (
      <Stack gap="md">
        {placement()}
        {status.isPending ? (
          <LoadingState label="Loading GPU Workloads" />
        ) : (
          <Alert color="red">{status.error.message}</Alert>
        )}
      </Stack>
    );
  const { operation, history } = status.data;
  const workloads = status.data.workloads.map((item) => {
    const work = live.data?.workloads[item.id];
    return work ? { ...item, ...work } : item;
  });
  const label = (id: string) => workloads.find((item) => item.id === id)?.label ?? id;
  const restartTarget = workloads.find((item) => item.id === restarting);
  // A change waiting for Radiance's work to stop it can stop it now instead.
  const stopsNow = (item: RuntimeStatus["workloads"][number]) =>
    Boolean(
      item.radiance && operation?.stop.includes(item.id) && !operation.start.includes(item.id),
    );
  const names = workloadNames(workloads);
  const running = workloads.filter((item) => holding(item.phase)).map((item) => item.id);
  const placed = status.data.placement ?? running;
  const chosen = selection ?? placed;
  const options = [...gpuPresets(status.data), { label: "Stopped", value: "stopped", target: [] }];
  const preset = options.find(({ target }) => sameSet(chosen, target));
  const individual = custom || !preset;
  const change = changeLine(names);
  // One short line for the running change, or for the latest one if it didn't finish.
  const failed = operation ? undefined : unfinished(history[0]);
  const shown = operation ?? failed;
  const line =
    shown &&
    (shown.type === "restart"
      ? { doing: "Restarting", verb: "restart", ids: shown.start }
      : shown.start.length
        ? { doing: "Switching to", verb: "switch to", ids: shown.start }
        : { doing: "Stopping", verb: "stop", ids: shown.stop });
  return (
    <Stack gap="md">
      {placement(
        workloads.length > 0 && (
          <Select
            aria-label="GPU Placement"
            w={phone ? "100%" : 280}
            flex="none"
            allowDeselect={false}
            value={individual ? "custom" : preset?.value}
            data={[...options, { value: "custom", label: "Custom" }]}
            disabled={Boolean(operation)}
            onChange={(value) => {
              setCustom(value === "custom");
              if (value !== "custom")
                setSelection(options.find((option) => option.value === value)?.target ?? null);
            }}
          />
        ),
      )}
      <DataTable
        label="GPU Workloads"
        rows={workloads}
        rowKey={(item) => item.id}
        rowName={(item) => item.label}
        empty="No GPU Workloads"
        compact
        columns={[
          ...(!individual
            ? []
            : [
                {
                  key: "run",
                  header: "Run",
                  width: 44,
                  cell: (item: RuntimeStatus["workloads"][number]) => (
                    <Checkbox
                      aria-label={`Run ${item.label}`}
                      // Phones fold this cell under the workload's name, without the column's header.
                      label={phone ? "Run" : undefined}
                      checked={chosen.includes(item.id)}
                      disabled={Boolean(operation)}
                      onChange={(event) =>
                        setSelection(
                          event.currentTarget.checked
                            ? [...chosen, item.id]
                            : chosen.filter((id) => id !== item.id),
                        )
                      }
                    />
                  ),
                },
              ]),
          {
            key: "workload",
            header: "Workload",
            main: true,
            sortValue: (item) => item.label,
            cell: (item) => {
              const short = changePhase(item.id, item.phase, operation, failed).failed;
              const note =
                short ||
                item.reason ||
                // A stopped workload isn't failing, whatever its shared endpoint says.
                (item.phase !== "parked" && reasons[item.id]);
              return (
                <>
                  <Text size="sm" fw={500}>
                    {item.label}
                  </Text>
                  {note && (
                    <Text
                      size="xs"
                      c={short ? "red" : "dimmed"}
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {note}
                    </Text>
                  )}
                </>
              );
            },
          },
          {
            key: "gpus",
            header: "GPUs",
            hideOnPhone: true,
            sortValue: (item) => item.gpus,
            cell: (item) => <Text size="sm">{item.gpus}</Text>,
          },
          {
            key: "state",
            header: "State",
            sortValue: (item) => phaseLabel(item.phase),
            cell: (item) => {
              const { pending } = changePhase(item.id, item.phase, operation);
              const phase = pending ?? item.phase;
              return (
                <Badge
                  color={phaseColour(phase)}
                  miw="max-content"
                  leftSection={pending && <Loader size={10} color="currentColor" />}
                >
                  {phaseLabel(phase)}
                </Badge>
              );
            },
          },
        ]}
        // Every workload lists the same actions, those its state doesn't allow disabled: running
        // it, then looking at it, then ending its work.
        rowActions={(item) => (
          <>
            <Menu.Item
              leftSection={<icons.resume size={16} />}
              disabled={Boolean(operation) || (item.phase !== "parked" && item.phase !== "down")}
              onClick={() => starting.mutate(item.id)}
            >
              Start
            </Menu.Item>
            <Menu.Item
              leftSection={<icons.stop size={16} />}
              disabled={Boolean(operation) || !running.includes(item.id)}
              onClick={() => previewing.mutate(running.filter((id) => id !== item.id))}
            >
              Stop
            </Menu.Item>
            <Menu.Item
              leftSection={stopsNow(item) ? <icons.stop size={16} /> : <icons.retry size={16} />}
              disabled={
                item.phase !== "running" ||
                (Boolean(operation) && !(item.radiance && operation?.stop.includes(item.id)))
              }
              onClick={() => setRestarting(item.id)}
            >
              {stopsNow(item) ? "Stop Now" : "Restart"}
            </Menu.Item>
            <Menu.Divider />
            {item.text && benchmarks?.configured && (
              <Menu.Item
                leftSection={<icons.benchmark size={16} />}
                disabled={benchmarking || item.phase !== "running"}
                onClick={() => setBenchmarkId(item.id)}
              >
                Benchmark…
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={<icons.log size={16} />}
              onClick={() => setWorkloadLogId(item.id)}
            >
              View Logs
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<icons.clear size={16} />}
              disabled={!item.jobs?.length && !item.queued}
              onClick={() => setQueueId(item.id)}
            >
              Cancel Queue
            </Menu.Item>
          </>
        )}
      />
      <Group justify="space-between" gap="xs">
        {shown && line ? (
          <Group gap="xs" wrap="nowrap" role="status" miw={0}>
            {operation && <Loader size="xs" />}
            <Text size="sm" c={operation ? undefined : "red"} style={{ overflowWrap: "anywhere" }}>
              {operation
                ? `${line.doing} ${names(line.ids)}…`
                : `Couldn't ${line.verb} ${names(line.ids)}: ${shown.error || shown.progress}`}
            </Text>
            <Button
              variant="subtle"
              size="compact-sm"
              flex="none"
              onClick={() => setLogId(shown.id)}
            >
              View Logs
            </Button>
            {operation && (
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                flex="none"
                onClick={() => setCancelling(operation.id)}
              >
                Stop Change
              </Button>
            )}
          </Group>
        ) : status.data.swaps === "paused" ? (
          <Text size="sm" c="dimmed">
            Placed by hand: automatic swaps paused until Radiance is placed.
          </Text>
        ) : (
          <span />
        )}
        <Group gap="xs" ml="auto">
          <Button
            variant="default"
            disabled={Boolean(operation) || (!selection && !custom)}
            onClick={() => {
              setSelection(null);
              setCustom(false);
            }}
          >
            Reset
          </Button>
          <Button
            disabled={Boolean(operation) || !selection || sameSet(chosen, placed)}
            loading={previewing.isPending}
            onClick={() => previewing.mutate(chosen)}
          >
            Preview Changes
          </Button>
        </Group>
      </Group>
      <OperationLog
        entry={history.find((entry) => entry.id === logId)}
        change={change}
        workloads={workloads}
        onClose={() => setLogId("")}
      />
      <WorkloadLog
        workload={workloads.find((item) => item.id === workloadLogId)}
        history={history}
        change={change}
        onClose={() => setWorkloadLogId("")}
      />
      <BenchmarkDialog
        workload={workloads.find((item) => item.id === benchmarkId)}
        onClose={() => setBenchmarkId("")}
      />
      <ConfirmDialog
        opened={Boolean(preview)}
        title="Apply GPU Placement"
        action="Apply"
        pending={applying.isPending}
        error={applying.error?.message}
        onConfirm={() => applying.mutate(preview!)}
        onClose={() => {
          setPreview(null);
          applying.reset();
        }}
      >
        {preview && <PlacementChanges preview={preview} label={label} />}
      </ConfirmDialog>
      <ConfirmDialog
        opened={Boolean(restartTarget)}
        title={`${restartTarget && stopsNow(restartTarget) ? "Stop Now" : "Restart"} ${restartTarget?.label ?? ""}`}
        action={restartTarget && stopsNow(restartTarget) ? "Stop Now" : "Restart"}
        pending={restart.isPending}
        error={restart.error?.message}
        onConfirm={() => restart.mutate(restartTarget!)}
        onClose={() => {
          setRestarting(null);
          restart.reset();
        }}
      >
        {!restartTarget?.radiance
          ? "Accepted work finishes first, then it restarts with the same model and GPUs."
          : `${stopsNow(restartTarget) ? "The change stops it without waiting for its work" : "It stops at once and starts again with the same model and GPUs"}. Its running work ends and is marked failed, so it can be retried; work already being cancelled is marked cancelled.`}
      </ConfirmDialog>
      <ConfirmDialog
        opened={Boolean(queueId)}
        title="Cancel Queue"
        action="Cancel Queue"
        pending={cancelQueue.isPending}
        error={cancelQueue.error?.message}
        onConfirm={() => cancelQueue.mutate(queueId)}
        onClose={() => {
          setQueueId("");
          cancelQueue.reset();
        }}
      >
        Every job waiting for {label(queueId)} is cancelled. Running work is asked to stop: it may
        still finish and save, or ends when {label(queueId)} restarts.
      </ConfirmDialog>
      <ConfirmDialog
        opened={Boolean(cancelling)}
        title="Stop Change"
        action="Stop Change"
        pending={cancel.isPending}
        error={cancel.error?.message}
        onConfirm={() => cancel.mutate(cancelling)}
        onClose={() => {
          setCancelling("");
          cancel.reset();
        }}
      >
        The change stops at its next step. Workloads it already stopped or started stay that way.
      </ConfirmDialog>
    </Stack>
  );
}

/** Settings › Workers › History: the runtime changes, the latest three until Show All. */
export function RuntimeHistory() {
  const status = useQuery(runtimeStatusQuery).data;
  const [logId, setLogId] = useState("");
  const who = useRequester();
  if (!status?.history.length) return null;
  const { history } = status;
  const change = changeLine(workloadNames(status.workloads));
  return (
    <SettingGroup title="History">
      <HistoryTable
        label="Runtime Changes"
        rows={history}
        rowKey={(entry) => entry.id}
        rowName={change}
        empty="No Changes"
        rowActions={(entry) => (
          <Menu.Item leftSection={<icons.log size={16} />} onClick={() => setLogId(entry.id)}>
            View Logs
          </Menu.Item>
        )}
        columns={[
          {
            key: "time",
            header: "Time",
            cell: (entry) => (
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {shortDateTime.format(new Date(entry.startedAt))}
              </Text>
            ),
          },
          {
            key: "change",
            header: "Change",
            main: true,
            cell: (entry) => (
              <Text
                size="sm"
                truncate
                title={`${entry.error || entry.progress} · ${who(entry.requestedBy)}`}
              >
                {change(entry)}
                {entry.error
                  ? ` · ${entry.error}`
                  : // Studio's own changes say why.
                    entry.requestedBy.startsWith("automatic: ") &&
                    ` · ${entry.requestedBy.slice("automatic: ".length)}`}
              </Text>
            ),
          },
          {
            key: "result",
            header: "Result",
            cell: (entry) => (
              <Badge color={operationColour(entry.status)} miw="max-content">
                {operationLabel(entry.status)}
              </Badge>
            ),
          },
        ]}
      />
      <OperationLog
        entry={history.find((entry) => entry.id === logId)}
        change={change}
        workloads={status.workloads}
        onClose={() => setLogId("")}
      />
    </SettingGroup>
  );
}
