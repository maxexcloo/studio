import { Alert, Badge, Button, Checkbox, Group, Loader, Menu, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  RuntimeOperation,
  RuntimePreview,
  RuntimeStatus,
  WorkloadPhase,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeading } from "../../ui/SectionHeading";

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
        Studio waits for accepted work on stopping workloads to finish and save, then stops them
        before it starts the others.
      </Text>
    </Stack>
  );
}

export const phaseColour = (phase: WorkloadPhase) =>
  ({ running: "green", starting: "yellow", stopping: "yellow", stopped: "gray", unknown: "red" })[
    phase
  ];
export const phaseLabel = (phase: WorkloadPhase) =>
  ({
    running: "Running",
    starting: "Starting",
    stopping: "Stopping",
    stopped: "Stopped",
    unknown: "Unknown",
  })[phase];
const operationColour = (status: RuntimeOperation["status"]) =>
  ({ running: "blue", completed: "green", failed: "red", interrupted: "yellow" })[status];
const operationLabel = (status: RuntimeOperation["status"]) =>
  ({ running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" })[
    status
  ];
const holding = (phase: WorkloadPhase) => phase === "running" || phase === "starting";
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Settings › Workers: which GPU deployments run, a previewed switch, restarts and the change history. */
export function RuntimeWorkloads() {
  const client = useQueryClient();
  const status = useQuery(runtimeStatusQuery);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<RuntimePreview | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: runtimeStatusQuery.queryKey });
  const previewing = useMutation({
    mutationFn: (workloads: string[]) =>
      post<RuntimePreview>("/api/runtime/preview", { workloads }),
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
  const { workloads, pools, operation, history, desired } = status.data;
  const label = (id: string) => workloads.find((item) => item.id === id)?.label ?? id;
  const names = (ids: string[]) => (ids.length ? ids.map(label).join(", ") : "None");
  const running = workloads.filter((item) => holding(item.phase)).map((item) => item.id);
  const chosen = selection ?? running;
  const change = (entry: RuntimeOperation) =>
    entry.type === "restart"
      ? `Restart ${names(entry.start)}`
      : `${names(entry.before)} → ${names(entry.after ?? entry.target)}`;
  const drifted = Boolean(desired && !operation && !sameSet(desired, running));
  return (
    <Stack gap="md" component="section" aria-label="GPU Workloads">
      <Group justify="space-between" gap="xs">
        <SectionHeading>GPU Workloads</SectionHeading>
        <Text size="xs" c="dimmed">
          {pools.map((pool) => `${pool.id}: ${pool.used} of ${pool.capacity} GPUs`).join(" · ")}
        </Text>
      </Group>
      {operation && (
        <Alert color="blue" title="Switching Workloads" icon={<Loader size={16} />}>
          {operation.progress}
        </Alert>
      )}
      {drifted && (
        <Alert color="yellow" title="Placement Changed Outside Studio">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              Studio last applied {names(desired!)}; something else (such as a Flux upgrade) has
              changed what runs.
            </Text>
            <Button size="compact-sm" variant="default" onClick={() => setSelection(desired!)}>
              Select Last Placement
            </Button>
          </Stack>
        </Alert>
      )}
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
            cell: (item) => (
              <>
                <Text size="sm" fw={500}>
                  {item.label}
                </Text>
                <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                  {item.reason ||
                    (item.acceptedOperations
                      ? `${item.acceptedOperations} accepted ${item.acceptedOperations === 1 ? "operation" : "operations"}`
                      : item.id)}
                </Text>
              </>
            ),
          },
          {
            key: "gpus",
            header: "GPUs",
            visibleFrom: "sm",
            sortValue: (item) => item.gpus,
            cell: (item) => (
              <Text size="sm">
                {item.gpus} · {item.pool}
              </Text>
            ),
          },
          {
            key: "state",
            header: "State",
            sortValue: (item) => phaseLabel(item.phase),
            cell: (item) => <Badge color={phaseColour(item.phase)}>{phaseLabel(item.phase)}</Badge>,
          },
        ]}
        rowActions={(item) => (
          <Menu.Item
            disabled={Boolean(operation) || item.phase !== "running"}
            onClick={() => setRestarting(item.id)}
          >
            Restart
          </Menu.Item>
        )}
      />
      <Group justify="flex-end" gap="xs">
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
        Studio waits for its accepted work to finish, stops it and starts it again with the same
        model and GPUs.
      </ConfirmDialog>
      {!!history.length && (
        <DataTable
          label="Runtime Changes"
          rows={history}
          rowKey={(entry) => entry.id}
          rowName={change}
          empty="No Changes"
          columns={[
            {
              key: "change",
              header: "Change",
              main: true,
              cell: (entry) => (
                <>
                  <Text size="sm">{change(entry)}</Text>
                  <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                    {entry.error || entry.progress} · {entry.requestedBy}
                  </Text>
                </>
              ),
            },
            {
              key: "started",
              header: "Started",
              visibleFrom: "sm",
              sortValue: (entry) => new Date(entry.startedAt).getTime(),
              cell: (entry) => <Text size="xs">{new Date(entry.startedAt).toLocaleString()}</Text>,
            },
            {
              key: "status",
              header: "Status",
              sortValue: (entry) => operationLabel(entry.status),
              cell: (entry) => (
                <Badge color={operationColour(entry.status)}>{operationLabel(entry.status)}</Badge>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
