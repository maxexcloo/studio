import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  RuntimeOperation,
  RuntimePreview,
  RuntimeSettings,
  RuntimeStatus,
  WorkloadPhase,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { useCopy } from "../../ui/clipboard";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";

export const runtimeStatusQuery = queryOptions({
  queryKey: ["runtime-status"],
  queryFn: () => api<RuntimeStatus>("/api/runtime"),
  // Follow a running change closely; otherwise refresh with the service status.
  refetchInterval: (query) => (query.state.data?.operation ? 2000 : 15000),
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

export const phaseColour = (phase: WorkloadPhase) =>
  ({
    running: "green",
    starting: "yellow",
    stopping: "yellow",
    parked: "gray",
    down: "red",
    unknown: "red",
  })[phase];
export const phaseLabel = (phase: WorkloadPhase) =>
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
    if (failed.start.includes(id) && phase !== "running") return { failed: "Couldn’t start." };
    if (failed.stop.includes(id) && !failed.start.includes(id) && holding(phase))
      return { failed: "Couldn’t stop." };
  }
  return {};
}

/** A change's steps as timestamped lines, then how it ended once it has. */
function logText(entry: RuntimeOperation) {
  const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour12: false });
  return [
    ...entry.steps.map((step) => `${time(step.at)}  ${step.message}`),
    ...(entry.finishedAt ? [`${time(entry.finishedAt)}  ${entry.error || entry.progress}`] : []),
  ].join("\n");
}

/** A runtime change's log: its steps oldest first, following new ones while it runs. */
function OperationLog({
  entry,
  change,
  onClose,
}: {
  entry?: RuntimeOperation;
  change: (entry: RuntimeOperation) => string;
  onClose: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();
  const text = entry ? logText(entry) : "";
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [text]);
  return (
    <Modal opened={Boolean(entry)} onClose={onClose} title="Runtime Log">
      {entry && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {`${change(entry)} · ${operationLabel(entry.status)} · ${entry.requestedBy} · ${new Date(
              entry.startedAt,
            ).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`}
          </Text>
          <ScrollArea.Autosize mah="50vh" viewportRef={viewport}>
            <Code block aria-label="Steps">
              {text || "No steps recorded."}
            </Code>
          </ScrollArea.Autosize>
          <Group justify="flex-end">
            <Button
              size="compact-sm"
              variant="default"
              leftSection={copied ? <Check size={16} /> : <icons.copy size={16} />}
              disabled={!text}
              onClick={() => copy(text, "log")}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Automatic control starts stopped media workloads for queued work and parks idle ones; never text. */
function AutomaticControl({ settings }: { settings: RuntimeSettings }) {
  const client = useQueryClient();
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: (patch: Partial<RuntimeSettings>) =>
      api<RuntimeSettings>("/api/runtime/settings", {
        method: "PUT",
        body: JSON.stringify({ ...settings, ...patch }),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: runtimeStatusQuery.queryKey }),
  });
  const minutes = [...new Set([0, 10, 15, 30, 60, settings.parkIdleMinutes])].sort((x, y) => x - y);
  return (
    <>
      <SettingRow
        label="Automatic Control"
        description="Start image and video workers for queued work; text stays manual."
      >
        <Switch
          aria-label="Automatic Control"
          checked={settings.automatic}
          onChange={(event) => save.mutate({ automatic: event.currentTarget.checked })}
        />
      </SettingRow>
      <SettingRow
        label="Park When Idle"
        description="Stop an idle image or video worker after this long, under Automatic Control."
      >
        <Select
          aria-label="Park When Idle"
          w={110}
          data={minutes.map((value) => ({
            value: String(value),
            label: value ? `${value} Min` : "Never",
          }))}
          value={String(settings.parkIdleMinutes)}
          allowDeselect={false}
          disabled={!settings.automatic}
          onChange={(value) => value && save.mutate({ parkIdleMinutes: Number(value) })}
        />
      </SettingRow>
      {save.error && (
        <Alert color="red" title="Couldn’t Save Automatic Control">
          {save.error.message}
        </Alert>
      )}
    </>
  );
}

/** Settings › Workers: which GPU deployments run, a previewed switch, restarts and the change history. */
export function RuntimeWorkloads({ reasons }: { reasons: Record<string, string> }) {
  const client = useQueryClient();
  const status = useQuery(runtimeStatusQuery);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<RuntimePreview | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [allChanges, setAllChanges] = useState(false);
  const [logId, setLogId] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: runtimeStatusQuery.queryKey });
  const previewing = useMutation({
    mutationFn: (workloads: string[]) =>
      post<RuntimePreview>("/api/runtime/preview", { workloads }),
    onSuccess: setPreview,
  });
  // Start one stopped workload beside what runs, making room as a Chat model start does.
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
      void refresh();
    },
  });
  const restart = useMutation({
    mutationFn: (workload: string) => post<RuntimeOperation>("/api/runtime/restart", { workload }),
    meta: { inlineError: true },
    onSuccess: () => {
      setRestarting(null);
      void refresh();
    },
  });
  if (status.isPending) return <LoadingState label="Loading GPU Workloads" />;
  if (status.error) return <Alert color="red">{status.error.message}</Alert>;
  const { workloads, operation, history, settings } = status.data;
  const label = (id: string) => workloads.find((item) => item.id === id)?.label ?? id;
  const names = (ids: string[]) => (ids.length ? ids.map(label).join(", ") : "None");
  const running = workloads.filter((item) => holding(item.phase)).map((item) => item.id);
  const chosen = selection ?? running;
  const change = (entry: RuntimeOperation) =>
    entry.type === "restart"
      ? `Restart ${names(entry.start)}`
      : `${names(entry.before)} → ${names(entry.after ?? entry.target)}`;
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
    <>
      <Stack gap="md">
        <AutomaticControl settings={settings} />
        <DataTable
          label="GPU Workloads"
          rows={workloads}
          rowKey={(item) => item.id}
          rowName={(item) => item.label}
          empty="No GPU Workloads"
          columns={[
            {
              key: "run",
              header: "Run",
              width: 44,
              cell: (item) => (
                <Checkbox
                  aria-label={`Run ${item.label}`}
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
                  reasons[item.id] ||
                  (item.acceptedOperations > 0 &&
                    `${item.acceptedOperations} accepted ${item.acceptedOperations === 1 ? "operation" : "operations"}`);
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
              visibleFrom: "sm",
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
          rowActions={(item) =>
            item.phase === "parked" || item.phase === "down" ? (
              <Menu.Item disabled={Boolean(operation)} onClick={() => starting.mutate(item.id)}>
                Start
              </Menu.Item>
            ) : (
              <Menu.Item
                disabled={Boolean(operation) || item.phase !== "running"}
                onClick={() => setRestarting(item.id)}
              >
                Restart
              </Menu.Item>
            )
          }
        />
        <Group justify="space-between" gap="xs">
          {shown && line ? (
            <Group gap="xs" wrap="nowrap" role="status" miw={0}>
              {operation && <Loader size="xs" />}
              <Text
                size="sm"
                c={operation ? undefined : "red"}
                style={{ overflowWrap: "anywhere" }}
              >
                {operation
                  ? `${line.doing} ${names(line.ids)}…`
                  : `Couldn’t ${line.verb} ${names(line.ids)}: ${shown.error || shown.progress}`}
              </Text>
              <Button variant="subtle" size="compact-sm" onClick={() => setLogId(shown.id)}>
                View Log
              </Button>
            </Group>
          ) : (
            <span />
          )}
          <Group gap="xs" ml="auto">
            <Button
              variant="default"
              disabled={!selection || sameSet(chosen, running)}
              onClick={() => setSelection(null)}
            >
              Reset
            </Button>
            <Button
              disabled={Boolean(operation) || sameSet(chosen, running)}
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
          onClose={() => setLogId("")}
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
          opened={Boolean(restarting)}
          title={`Restart ${restarting ? label(restarting) : ""}`}
          action="Restart"
          pending={restart.isPending}
          error={restart.error?.message}
          onConfirm={() => restart.mutate(restarting!)}
          onClose={() => {
            setRestarting(null);
            restart.reset();
          }}
        >
          Accepted work finishes first, then it restarts with the same model and GPUs.
        </ConfirmDialog>
      </Stack>
      {!!history.length && (
        <SettingGroup title="History">
          <Stack gap={4} align="flex-start">
            <DataTable
              label="Runtime Changes"
              rows={allChanges ? history : history.slice(0, 3)}
              rowKey={(entry) => entry.id}
              rowName={change}
              empty="No Changes"
              rowActions={(entry) => (
                <Menu.Item leftSection={<icons.log size={16} />} onClick={() => setLogId(entry.id)}>
                  View Log
                </Menu.Item>
              )}
              columns={[
                {
                  key: "time",
                  header: "Time",
                  cell: (entry) => (
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      {new Date(entry.startedAt).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
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
                      title={`${entry.error || entry.progress} · ${entry.requestedBy}`}
                    >
                      {change(entry)}
                      {entry.error && ` · ${entry.error}`}
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
            {history.length > 3 && (
              <Button variant="subtle" size="compact-sm" onClick={() => setAllChanges(!allChanges)}>
                {allChanges ? "Show Less" : "Show All"}
              </Button>
            )}
          </Stack>
        </SettingGroup>
      )}
    </>
  );
}
