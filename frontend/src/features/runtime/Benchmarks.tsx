import { Alert, Badge, Button, FocusTrap, Loader, Menu, Modal, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  type BenchmarkModel,
  type BenchmarkRun,
  type BenchmarkStatus,
  activeBenchmark,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SelectionList } from "../../ui/SelectionList";
import { SettingGroup } from "../../ui/SettingRows";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { LogDialog, PodLog, useRequester } from "./RuntimeLogs";

export const benchmarksQuery = queryOptions({
  queryKey: ["runtime-benchmarks"],
  queryFn: () => api<BenchmarkStatus>("/api/runtime/benchmarks"),
  refetchInterval: (query) => (query.state.data?.runs.some(activeBenchmark) ? 10000 : false),
});

const benchmarkModelsQuery = (workload: string) =>
  queryOptions({
    queryKey: ["runtime-benchmark-models", workload],
    queryFn: () =>
      api<{ models: BenchmarkModel[] }>(
        `/api/runtime/workloads/${encodeURIComponent(workload)}/benchmark-models`,
      ),
    enabled: Boolean(workload),
  });

const shortDateTime = dateFormat({ dateStyle: "short", timeStyle: "short" });
const statusColour = (status: BenchmarkRun["status"]) =>
  ({
    queued: "gray",
    running: "blue",
    stopping: "gray",
    completed: "green",
    failed: "red",
    stopped: "gray",
  })[status];
const statusLabel = (status: BenchmarkRun["status"]) =>
  ({
    queued: "Queued",
    running: "Running",
    stopping: "Stopping",
    completed: "Completed",
    failed: "Failed",
    stopped: "Stopped",
  })[status];
const rate = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : `${value.toFixed(digits)} tok/s`;
const thousands = (tokens: number) => `${Math.round(tokens / 1000)}K`;
const canStop = (run: BenchmarkRun) => run.status === "queued" || run.status === "running";

/** Choose which text models to benchmark on the selected workload. */
export function BenchmarkDialog({
  workload: opened,
  onClose,
}: {
  workload?: { id: string; label: string };
  onClose: () => void;
}) {
  const id = useId();
  const workload = useLastWhileClosing(opened);
  const client = useQueryClient();
  const inventory = useQuery(benchmarkModelsQuery(workload?.id ?? ""));
  const [selected, setSelected] = useState<string[]>();
  const models = inventory.data?.models ?? [];
  const ids = models.map(({ id }) => id);
  const chosen = selected?.filter((id) => ids.includes(id)) ?? (ids.length === 1 ? ids : []);
  const start = useMutation({
    mutationFn: (choice: { workload: string; models: string[] }) =>
      post<BenchmarkRun[]>("/api/runtime/benchmarks", choice),
    meta: { inlineError: true },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benchmarksQuery.queryKey });
      setSelected(undefined);
      onClose();
    },
  });
  const error = start.error || inventory.error;
  const close = () => {
    if (!start.isPending) onClose();
  };
  return (
    <Modal
      id={id}
      opened={Boolean(opened)}
      title={`Benchmark ${workload?.label ?? ""}`}
      size="md"
      onClose={closeWhenTop(id, close)}
      onExitTransitionEnd={() => {
        start.reset();
        setSelected(undefined);
      }}
      closeButtonProps={{ "aria-label": "Close", disabled: start.isPending }}
    >
      <FocusTrap.InitialFocus />
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Models run one at a time. Other work on this worker can affect the results.
        </Text>
        {inventory.isPending ? (
          <LoadingState label="Loading Models" fill />
        ) : models.length ? (
          <SelectionList
            label="Text Models"
            groups={[{ items: models.map(({ id, label }) => ({ value: id, label })) }]}
            value={chosen}
            onChange={setSelected}
            disabled={start.isPending}
          />
        ) : inventory.isSuccess ? (
          <EmptyState fill>No Text Models Available</EmptyState>
        ) : null}
        {error && <Alert color="red">{error.message}</Alert>}
        <DialogFooter pending={start.isPending} onCancel={close}>
          <Button
            loading={start.isPending}
            disabled={inventory.isFetching || !chosen.length}
            onClick={() => {
              if (workload && chosen.length)
                start.mutate({ workload: workload.id, models: chosen });
            }}
          >
            Benchmark
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}

/** Settings › Workers › Benchmarks: every run, newest first, with BetterBench's headline figures. */
export function BenchmarkResults() {
  const client = useQueryClient();
  const status = useQuery(benchmarksQuery).data;
  const [stopping, setStopping] = useState("");
  const [logId, setLogId] = useState("");
  const who = useRequester();
  const stop = useMutation({
    mutationFn: (id: string) => post<BenchmarkRun>(`/api/runtime/benchmarks/${id}/stop`, {}),
    meta: { inlineError: true },
    onSuccess: () => {
      setStopping("");
      void client.invalidateQueries({ queryKey: benchmarksQuery.queryKey });
    },
  });
  if (!status?.configured) return null;
  return (
    <SettingGroup title="Benchmarks">
      <DataTable
        label="Benchmarks"
        rows={status.runs}
        rowKey={(run) => run.id}
        rowName={(run) =>
          [run.label, run.model, run.startedAt && shortDateTime.format(new Date(run.startedAt))]
            .filter(Boolean)
            .join(" · ")
        }
        empty="No Benchmarks"
        rowActions={(run) =>
          (run.startedAt || canStop(run)) && (
            <>
              {run.startedAt && (
                <Menu.Item leftSection={<icons.log size={16} />} onClick={() => setLogId(run.id)}>
                  View Logs
                </Menu.Item>
              )}
              {canStop(run) && (
                <Menu.Item
                  color="red"
                  leftSection={<icons.stop size={16} />}
                  onClick={() => setStopping(run.id)}
                >
                  Stop
                </Menu.Item>
              )}
            </>
          )
        }
        columns={[
          {
            key: "time",
            header: "Time",
            cell: (run) => (
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {run.startedAt ? shortDateTime.format(new Date(run.startedAt)) : "—"}
              </Text>
            ),
          },
          {
            key: "model",
            header: "Model",
            main: true,
            sortValue: (run) => run.model,
            cell: (run) => (
              <Stack gap={0}>
                <Text size="sm" fw={500}>
                  {run.model}
                </Text>
                <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                  {run.label} · Requested by {who(run.requestedBy)}
                </Text>
                {run.error && (
                  <Text size="xs" c="red">
                    {run.error}
                  </Text>
                )}
              </Stack>
            ),
          },
          {
            key: "decode",
            header: "Decode",
            nowrap: true,
            sortValue: (run) => run.summary?.decode ?? undefined,
            cell: (run) => <Text size="sm">{rate(run.summary?.decode, 1)}</Text>,
          },
          {
            key: "ttft",
            header: "First Token",
            nowrap: true,
            hideOnPhone: true,
            sortValue: (run) => run.summary?.ttftMs ?? undefined,
            cell: (run) => (
              <Text size="sm">
                {run.summary?.ttftMs == null ? "—" : `${Math.round(run.summary.ttftMs)} ms`}
              </Text>
            ),
          },
          {
            key: "aggregate",
            header: "Concurrent",
            nowrap: true,
            hideOnPhone: true,
            sortValue: (run) => run.summary?.aggregate?.tps,
            cell: (run) => (
              <Text size="sm">
                {rate(run.summary?.aggregate?.tps)}
                {run.summary?.aggregate && (
                  <Text span size="xs" c="dimmed">
                    {` · ${run.summary.aggregate.level}×`}
                  </Text>
                )}
              </Text>
            ),
          },
          {
            key: "prefill",
            header: "Prefill",
            nowrap: true,
            hideOnPhone: true,
            sortValue: (run) => run.summary?.prefill?.tps ?? undefined,
            cell: (run) => (
              <Text size="sm">
                {rate(run.summary?.prefill?.tps)}
                {run.summary?.prefill && (
                  <Text span size="xs" c="dimmed">
                    {` · ${thousands(run.summary.prefill.depth)}`}
                  </Text>
                )}
              </Text>
            ),
          },
          {
            key: "result",
            header: "Result",
            cell: (run) => (
              <Badge
                color={statusColour(run.status)}
                miw="max-content"
                leftSection={run.status === "running" && <Loader size={10} color="currentColor" />}
              >
                {statusLabel(run.status)}
              </Badge>
            ),
          },
        ]}
      />
      <LogDialog
        title={`${status.runs.find((run) => run.id === logId)?.label ?? ""} Benchmark Log`}
        opened={Boolean(logId)}
        onClose={() => setLogId("")}
        parts={[
          {
            value: "pod",
            label: "Pod",
            content: logId && (
              <PodLog path={`/api/runtime/benchmarks/${encodeURIComponent(logId)}/logs`} />
            ),
          },
        ]}
      />
      <ConfirmDialog
        opened={Boolean(stopping)}
        title="Stop Benchmark"
        action="Stop"
        pending={stop.isPending}
        error={stop.error?.message}
        onConfirm={() => stop.mutate(stopping)}
        onClose={() => {
          setStopping("");
          stop.reset();
        }}
      >
        The benchmark ends without results.
      </ConfirmDialog>
    </SettingGroup>
  );
}
