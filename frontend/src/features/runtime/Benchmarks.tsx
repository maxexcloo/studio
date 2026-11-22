import { Badge, Button, Group, Loader, Menu, MultiSelect, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type BenchmarkModel,
  type BenchmarkRun,
  type BenchmarkStatus,
  activeBenchmark,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SettingGroup } from "../../ui/SettingRows";
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
  workload,
  onClose,
}: {
  workload?: { id: string; label: string };
  onClose: () => void;
}) {
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
  const unavailable = inventory.isFetching || !models.length || start.isPending;
  return (
    <ConfirmDialog
      opened={Boolean(workload)}
      title={`Benchmark ${workload?.label ?? ""}`}
      action="Benchmark"
      pending={start.isPending}
      disabled={inventory.isFetching || !chosen.length}
      error={start.error?.message || inventory.error?.message}
      onConfirm={() => {
        if (workload && chosen.length) start.mutate({ workload: workload.id, models: chosen });
      }}
      onClose={() => {
        start.reset();
        setSelected(undefined);
        onClose();
      }}
    >
      <Stack gap="sm">
        <Text size="sm">
          BetterBench measures decode, prompt processing and concurrent throughput. Models run one
          at a time. Loading them may delay other work, and concurrent activity affects results.
        </Text>
        <Group align="flex-end" wrap="nowrap">
          <MultiSelect
            label="Text Models"
            placeholder={
              chosen.length ? undefined : inventory.isFetching ? "Loading Models" : "Choose Models"
            }
            data={models.map(({ id, label }) => ({ value: id, label }))}
            value={chosen}
            onChange={setSelected}
            searchable
            nothingFoundMessage="No Matches"
            clearable
            clearButtonProps={{ "aria-label": "Clear Models" }}
            disabled={unavailable}
            comboboxProps={{ withinPortal: false }}
            flex={1}
            miw={0}
          />
          {models.length > 1 && (
            <Button
              variant="default"
              disabled={unavailable || chosen.length === models.length}
              onClick={() => setSelected(ids)}
            >
              Select All
            </Button>
          )}
        </Group>
        {inventory.isSuccess && !models.length && <Text size="sm">No text models available.</Text>}
      </Stack>
    </ConfirmDialog>
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
      <Text size="sm" c="dimmed">
        Recent benchmarks, newest first, and who asked.
      </Text>
      <DataTable
        label="Benchmarks"
        rows={status.runs}
        rowKey={(run) => run.id}
        rowName={(run) => run.label}
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
            sortValue: (run) => run.summary?.decode ?? undefined,
            cell: (run) => <Text size="sm">{rate(run.summary?.decode, 1)}</Text>,
          },
          {
            key: "ttft",
            header: "First Token",
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
