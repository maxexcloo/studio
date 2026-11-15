import { Badge, Loader, Menu, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { BenchmarkRun, BenchmarkStatus } from "../../../../shared/runtime";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SettingGroup } from "../../ui/SettingRows";

export const benchmarksQuery = queryOptions({
  queryKey: ["runtime-benchmarks"],
  queryFn: () => api<BenchmarkStatus>("/api/runtime/benchmarks"),
  refetchInterval: (query) =>
    query.state.data?.runs.some((run) => run.status === "running") ? 10000 : false,
});

const shortDateTime = dateFormat({ dateStyle: "short", timeStyle: "short" });
const statusColour = (status: BenchmarkRun["status"]) =>
  ({ running: "blue", completed: "green", failed: "red", stopped: "gray" })[status];
const statusLabel = (status: BenchmarkRun["status"]) =>
  ({ running: "Running", completed: "Completed", failed: "Failed", stopped: "Stopped" })[status];
const rate = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : `${value.toFixed(digits)} tok/s`;
const thousands = (tokens: number) => `${Math.round(tokens / 1000)}K`;

/** Confirms benchmarking one running local text model, then starts it. */
export function BenchmarkDialog({
  workload,
  onClose,
}: {
  workload?: { id: string; label: string };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: (id: string) => post<BenchmarkRun>("/api/runtime/benchmarks", { workload: id }),
    meta: { inlineError: true },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benchmarksQuery.queryKey });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      opened={Boolean(workload)}
      title={`Benchmark ${workload?.label ?? ""}`}
      action="Benchmark"
      pending={start.isPending}
      error={start.error?.message}
      onConfirm={() => start.mutate(workload!.id)}
      onClose={() => {
        start.reset();
        onClose();
      }}
    >
      BetterBench's quick pass measures decode, prompt processing and concurrent throughput over
      several minutes. Studio keeps using the model meanwhile, which shows in the figures.
    </ConfirmDialog>
  );
}

/** Settings › Workers › Benchmarks: every run, newest first, with BetterBench's headline figures. */
export function BenchmarkResults() {
  const client = useQueryClient();
  const status = useQuery(benchmarksQuery).data;
  const [stopping, setStopping] = useState("");
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
        rowName={(run) => run.label}
        empty="No Benchmarks"
        compact
        rowActions={(run) =>
          run.status === "running" && (
            <Menu.Item
              color="red"
              leftSection={<icons.stop size={16} />}
              onClick={() => setStopping(run.id)}
            >
              Stop
            </Menu.Item>
          )
        }
        columns={[
          {
            key: "model",
            header: "Model",
            main: true,
            sortValue: (run) => run.label,
            cell: (run) => (
              <Stack gap={0}>
                <Text size="sm" fw={500}>
                  {run.label}
                </Text>
                <Text
                  size="xs"
                  c={run.error ? "red" : "dimmed"}
                  style={{ overflowWrap: "anywhere" }}
                >
                  {run.error ?? `${run.model} · ${shortDateTime.format(new Date(run.startedAt))}`}
                </Text>
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
