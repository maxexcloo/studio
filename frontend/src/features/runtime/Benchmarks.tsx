import {
  Alert,
  Badge,
  Button,
  FocusTrap,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  type BenchmarkModel,
  type BenchmarkRun,
  type BenchmarkStatus,
  type BenchmarkSuite,
  activeBenchmark,
} from "../../../../shared/runtime";
import { api, post } from "../../api";
import { formatBytes } from "../../ui/bytes";
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

const benchmarkModelsQuery = (workload: string, suite: BenchmarkSuite) =>
  queryOptions({
    queryKey: ["runtime-benchmark-models", workload, suite],
    queryFn: () =>
      api<{ models: BenchmarkModel[] }>(
        `/api/runtime/workloads/${encodeURIComponent(workload)}/benchmark-models${suite === "betterbench" ? "" : `?suite=${encodeURIComponent(suite)}`}`,
      ),
    enabled: Boolean(workload),
  });

const suiteLabels: Record<BenchmarkSuite, string> = {
  betterbench: "BetterBench",
  qualitybench: "QualityBench",
  "radiance-media": "Radiance Test",
};
const suiteDescriptions: Record<BenchmarkSuite, string> = {
  betterbench: "Measures text generation speed, latency, concurrency and prefill.",
  qualitybench: "Measures text model answer quality and task accuracy.",
  "radiance-media":
    "Runs a quick image or video smoke and speed test on Radiance without saving to any gallery.",
};

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
const seconds = (ms: number | null | undefined) =>
  ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
const thousands = (tokens: number) => `${Math.round(tokens / 1000)}K`;
const canStop = (run: BenchmarkRun) => run.status === "queued" || run.status === "running";

/** Which benchmark/test suites this workload can run, in display order. */
export function workloadSuites(
  workload: { text?: true; radiance?: true },
  status?: BenchmarkStatus,
): BenchmarkSuite[] {
  if (!status?.configured) return [];
  const enabled = status.suites ?? ["betterbench"];
  return enabled.filter((suite) =>
    suite === "radiance-media" ? Boolean(workload.radiance) : Boolean(workload.text),
  );
}

/** Choose which suite and models to benchmark or test on the selected workload. */
export function BenchmarkDialog({
  workload: opened,
  onClose,
}: {
  workload?: { id: string; label: string; text?: true; radiance?: true };
  onClose: () => void;
}) {
  const id = useId();
  const workload = useLastWhileClosing(opened);
  const client = useQueryClient();
  const status = useQuery(benchmarksQuery).data;
  const availableSuites = workload ? workloadSuites(workload, status) : [];
  const [suiteChoice, setSuiteChoice] = useState<BenchmarkSuite>();
  const suite: BenchmarkSuite =
    suiteChoice && availableSuites.includes(suiteChoice)
      ? suiteChoice
      : (availableSuites[0] ?? "betterbench");
  const inventory = useQuery(benchmarkModelsQuery(workload?.id ?? "", suite));
  const [selected, setSelected] = useState<string[]>();
  const models = inventory.data?.models ?? [];
  const ids = models.map(({ id }) => id);
  const chosen = selected?.filter((id) => ids.includes(id)) ?? (ids.length === 1 ? ids : []);
  const start = useMutation({
    mutationFn: (choice: { workload: string; models: string[]; suite?: BenchmarkSuite }) =>
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
  const isMedia = suite === "radiance-media";
  const imageModels = models.filter((model) => model.kind === "image");
  const videoModels = models.filter((model) => model.kind === "video");
  const groups = isMedia
    ? [
        ...(imageModels.length
          ? [{ label: "Images", items: imageModels.map(({ id, label }) => ({ value: id, label })) }]
          : []),
        ...(videoModels.length
          ? [{ label: "Videos", items: videoModels.map(({ id, label }) => ({ value: id, label })) }]
          : []),
      ]
    : [{ items: models.map(({ id, label }) => ({ value: id, label })) }];
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
        setSuiteChoice(undefined);
      }}
      closeButtonProps={{ "aria-label": "Close", disabled: start.isPending }}
    >
      <FocusTrap.InitialFocus />
      <Stack gap="md">
        {availableSuites.length > 1 && (
          <SegmentedControl
            aria-label="Benchmark Suite"
            fullWidth
            value={suite}
            onChange={(value) => {
              setSuiteChoice(value as BenchmarkSuite);
              setSelected(undefined);
            }}
            data={availableSuites.map((item) => ({ value: item, label: suiteLabels[item] }))}
            disabled={start.isPending}
          />
        )}
        <Text size="sm" c="dimmed">
          {suiteDescriptions[suite]} Models run one at a time while new Studio jobs on this worker
          wait.
        </Text>
        {inventory.isPending ? (
          <LoadingState label="Loading Models" fill />
        ) : models.length ? (
          <SelectionList
            label={isMedia ? "Radiance Models" : "Text Models"}
            groups={groups}
            value={chosen}
            onChange={setSelected}
            disabled={start.isPending}
          />
        ) : inventory.isSuccess ? (
          <EmptyState fill>
            {isMedia ? "No Radiance Models Available" : "No Text Models Available"}
          </EmptyState>
        ) : null}
        {error && <Alert color="red">{error.message}</Alert>}
        <DialogFooter pending={start.isPending} onCancel={close}>
          <Button
            loading={start.isPending}
            disabled={inventory.isFetching || !chosen.length}
            onClick={() => {
              if (workload && chosen.length)
                start.mutate({
                  workload: workload.id,
                  models: chosen,
                  ...(suite !== "betterbench" ? { suite } : {}),
                });
            }}
          >
            {isMedia ? "Run Test" : "Benchmark"}
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}

/** Settings › Workers › Benchmarks: every run, newest first, across BetterBench, QualityBench & Radiance Tests. */
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
  const multipleSuites = (status.suites?.length ?? 1) > 1 || status.runs.some((run) => run.suite);
  return (
    <SettingGroup title="Benchmarks">
      <DataTable
        label="Benchmarks"
        rows={status.runs}
        rowKey={(run) => run.id}
        rowName={(run) =>
          [
            run.label,
            run.modelLabel || run.model,
            run.startedAt && shortDateTime.format(new Date(run.startedAt)),
          ]
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
            sortValue: (run) => run.modelLabel || run.model,
            cell: (run) => {
              const suite = run.suite ?? "betterbench";
              return (
                <Stack gap={0}>
                  <Text size="sm" fw={500}>
                    {run.modelLabel || run.model}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                    {[
                      run.label,
                      multipleSuites ? suiteLabels[suite] : "",
                      `Requested by ${who(run.requestedBy)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  {run.error && (
                    <Text size="xs" c="red">
                      {run.error}
                    </Text>
                  )}
                </Stack>
              );
            },
          },
          {
            key: "decode",
            header: multipleSuites ? "Primary" : "Decode",
            sortValue: (run) =>
              run.summary?.score ?? run.summary?.decode ?? run.summary?.generateMs ?? undefined,
            cell: (run) => {
              const suite = run.suite ?? run.summary?.suite ?? "betterbench";
              if (suite === "qualitybench")
                return <Text size="sm">{percent(run.summary?.score)}</Text>;
              if (suite === "radiance-media")
                return <Text size="sm">{seconds(run.summary?.generateMs)}</Text>;
              return <Text size="sm">{rate(run.summary?.decode, 1)}</Text>;
            },
          },
          {
            key: "ttft",
            header: multipleSuites ? "Latency / Load" : "First Token",
            hideOnPhone: true,
            sortValue: (run) => run.summary?.ttftMs ?? run.summary?.loadMs ?? undefined,
            cell: (run) => {
              const suite = run.suite ?? run.summary?.suite ?? "betterbench";
              if (suite === "qualitybench")
                return (
                  <Text size="sm" c="dimmed">
                    {run.summary?.tasks?.length ? `${run.summary.tasks.length} tasks` : "—"}
                  </Text>
                );
              if (suite === "radiance-media")
                return (
                  <Text size="sm">
                    {run.summary?.loadMs === 0
                      ? "Resident"
                      : run.summary?.loadMs != null
                        ? `Load ${seconds(run.summary.loadMs)}`
                        : "—"}
                  </Text>
                );
              return (
                <Text size="sm">
                  {run.summary?.ttftMs == null ? "—" : `${Math.round(run.summary.ttftMs)} ms`}
                </Text>
              );
            },
          },
          {
            key: "aggregate",
            header: multipleSuites ? "Concurrent / Detail" : "Concurrent",
            hideOnPhone: true,
            sortValue: (run) => run.summary?.aggregate?.tps,
            cell: (run) => {
              const suite = run.suite ?? run.summary?.suite ?? "betterbench";
              if (suite === "qualitybench")
                return (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {run.summary?.tasks
                      ?.slice(0, 3)
                      .map((task) => `${task.name} ${task.score.toFixed(0)}%`)
                      .join(" · ") || "—"}
                  </Text>
                );
              if (suite === "radiance-media")
                return (
                  <Text size="sm">
                    {run.summary?.bytes != null ? formatBytes(run.summary.bytes) : "—"}
                  </Text>
                );
              return (
                <Text size="sm">
                  {rate(run.summary?.aggregate?.tps)}
                  {run.summary?.aggregate && (
                    <Text span size="xs" c="dimmed">
                      {` · ${run.summary.aggregate.level}×`}
                    </Text>
                  )}
                </Text>
              );
            },
          },
          {
            key: "prefill",
            header: "Prefill",
            hideOnPhone: true,
            sortValue: (run) => run.summary?.prefill?.tps ?? undefined,
            cell: (run) => {
              const suite = run.suite ?? run.summary?.suite ?? "betterbench";
              if (suite !== "betterbench") return <Text size="sm">—</Text>;
              return (
                <Text size="sm">
                  {rate(run.summary?.prefill?.tps)}
                  {run.summary?.prefill && (
                    <Text span size="xs" c="dimmed">
                      {` · ${thousands(run.summary.prefill.depth)}`}
                    </Text>
                  )}
                </Text>
              );
            },
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
            label: "Log",
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
