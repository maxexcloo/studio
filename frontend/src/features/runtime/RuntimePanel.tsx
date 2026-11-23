import { Alert, Group, Stack, Text } from "@mantine/core";
import { type UseQueryResult, queryOptions, useQuery } from "@tanstack/react-query";
import { Circle, CircleDot } from "lucide-react";

import type {
  ServiceHealth,
  ServiceKind,
  ServiceStatus,
  ServicesStatus,
  WorkerStatus,
} from "../../../../shared/services";
import { api } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { BenchmarkResults } from "./Benchmarks";
import { RuntimeHistory, RuntimeWorkloads } from "./RuntimeWorkloads";

const services = [
  { kind: "image", label: "Images" },
  { kind: "video", label: "Videos" },
  { kind: "text", label: "Text" },
] as const;
const healthColour = (state: ServiceHealth) =>
  ({ healthy: "green", offline: "red", parked: "gray", unknown: "yellow", waiting: "yellow" })[
    state
  ];
const healthLabel = (state: ServiceHealth) =>
  ({
    healthy: "Running",
    offline: "Offline",
    parked: "Stopped",
    unknown: "Unknown",
    waiting: "Waiting",
  })[state];
const capabilityLabels: Record<string, string> = {
  image: "Images",
  models: "Model Library",
  upscale: "Upscale",
  video: "Videos",
};

/**
 * What a worker, or the workers serving a kind, are doing: its failing or stopped state, else Busy
 * or Idle, then how much waits for it. Settings › Workers and Status both read it this way.
 */
const activity = (state: ServiceHealth, running: boolean, queued: number) =>
  [
    state !== "healthy" ? healthLabel(state) : running ? "Busy" : "Idle",
    queued > 0 && `${queued} Queued`,
  ].filter((part) => part !== false);

/** "11.2 GiB Free" from a worker's free memory in bytes. */
const gibFree = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB Free`;

/**
 * Each media worker on one compact line: its health dot and name, then what it runs, its state,
 * how much waits for it and its free memory. Its reason is the line's tooltip.
 */
function WorkerList({ workers }: { workers: WorkerStatus[] }) {
  return workers.length ? (
    <Stack gap={0} component="ul" aria-label="Workers" m={0} p={0} style={{ listStyle: "none" }}>
      {workers.map((worker) => (
        <Group
          key={worker.id}
          component="li"
          gap="xs"
          py={6}
          wrap="nowrap"
          align="baseline"
          title={worker.reason}
        >
          <CircleDot
            size={12}
            color={`var(--mantine-color-${healthColour(worker.state)}-6)`}
            style={{ flexShrink: 0, alignSelf: "center" }}
          />
          <Text size="sm">
            <Text span fw={500}>
              {worker.label}
            </Text>
            <Text span c="dimmed">
              {[
                "",
                worker.capabilities.map((id) => capabilityLabels[id] || id).join(", "),
                ...activity(worker.state, Boolean(worker.currentJob), worker.queued),
                worker.memoryFree !== undefined && gibFree(worker.memoryFree),
              ]
                .filter((part) => part !== false)
                .join(" · ")}
            </Text>
          </Text>
        </Group>
      ))}
    </Stack>
  ) : (
    <Text size="sm" c="dimmed">
      The deployment lists no workers, so Studio can't generate.
    </Text>
  );
}
export const servicesStatusQuery = queryOptions({
  queryKey: ["services-status"],
  queryFn: () => api<ServicesStatus>("/api/services/status"),
  refetchInterval: 15000,
});
/**
 * Header summary: partial readiness is yellow, nothing usable is red and nothing is green until it
 * is observed. Parked services were stopped on purpose, so they never count as failing.
 */
export function serviceSummary({ data, error }: UseQueryResult<ServicesStatus>) {
  const all = Object.values(data?.services || {}).map((service) => service.state);
  const states = all.filter((state) => state !== "parked");
  if (error) return { colour: "yellow", label: "Service Status Unavailable" };
  if (!all.length) return { colour: "gray", label: "Checking Services" };
  if (!states.length) return { colour: "gray", label: "Services Stopped" };
  if (states.every((state) => state === "healthy"))
    return {
      colour: "green",
      label: states.length < all.length ? "Services Running · Some Stopped" : "Services Running",
    };
  if (states.every((state) => state === "offline" || state === "unknown"))
    return { colour: "red", label: "Services Unavailable" };
  return { colour: "yellow", label: "Services Partly Available" };
}
/**
 * A kind's workers that can run (a parked one is Stopped, not available) and what they are doing,
 * or Stopped when every one is parked.
 */
const serviceDetail = (kind: ServiceKind, service: ServiceStatus) => {
  if (service.state === "parked") return healthLabel(service.state);
  const live = service.endpoints.filter((endpoint) => endpoint.state !== "parked");
  const state =
    kind === "text"
      ? [healthLabel(service.state)]
      : activity(
          service.state,
          live.some((endpoint) => endpoint.running),
          live.reduce((sum, endpoint) => sum + (endpoint.queued ?? 0), 0),
        );
  return [plural(live.length, "worker"), ...state].join(" · ");
};
function SummaryLine({
  label,
  detail,
  colour,
  hollow = false,
  reason,
}: {
  label: string;
  detail: string;
  colour: string;
  hollow?: boolean;
  reason: string;
}) {
  return (
    <Group gap="xs" wrap="nowrap" aria-label={`${label}: ${detail}`}>
      <Circle
        size={10}
        strokeWidth={2.5}
        fill={hollow ? "none" : "currentColor"}
        style={{ flexShrink: 0, color: `var(--mantine-color-${colour}-6)` }}
      />
      <Text size="sm" miw={56}>
        {label}
      </Text>
      <Text size="sm" c="dimmed" title={reason} ml="auto" ta="right">
        {detail}
      </Text>
    </Group>
  );
}
/**
 * The status panel's quiet summary, one line per kind: its health dot, then how many workers
 * can serve it and their state. Text without a local worker runs in the cloud. Cloud, between
 * Videos and Text, gives each cloud provider account's use of its quota window. Read-only and the same for everyone;
 * Settings › Workers holds the controls.
 */
export function ServiceHealthSummary() {
  const status = useQuery(servicesStatusQuery);
  if (status.error)
    return (
      <Text size="sm" c="red">
        {status.error.message}
      </Text>
    );
  const available = services.filter(({ kind }) => status.data?.services[kind]);
  const usage = status.data?.cloud;
  const summary = ({ kind, label }: (typeof services)[number]) => {
    const service = status.data!.services[kind]!;
    const cloudOnly = kind === "text" && !service.endpoints.length;
    return (
      <SummaryLine
        key={kind}
        label={label}
        detail={cloudOnly ? "Cloud only" : serviceDetail(kind, service)}
        colour={cloudOnly ? "gray" : healthColour(service.state)}
        hollow={cloudOnly}
        reason={service.reason}
      />
    );
  };
  const cloud = usage && (
    <SummaryLine
      label="Cloud"
      detail={usage
        .map(
          (account) =>
            `${account.label} · ${account.used === undefined ? "Unknown" : `${Math.round(account.used)}% Used`}`,
        )
        .join(", ")}
      colour={
        usage.some((account) => account.used === undefined)
          ? healthColour("unknown")
          : usage.some((account) => account.used! >= 100)
            ? healthColour("offline")
            : healthColour("healthy")
      }
      reason={usage
        .map((account) =>
          account.resetsAt
            ? `${account.reason} Resets ${new Date(account.resetsAt).toLocaleString()}.`
            : account.reason,
        )
        .join(" ")}
    />
  );
  return (
    <Stack gap={4} component="section" aria-label="Service Status">
      {status.isPending && (
        <Text size="sm" c="dimmed">
          Checking Services
        </Text>
      )}
      {available.filter(({ kind }) => kind !== "text").map(summary)}
      {cloud}
      {available.filter(({ kind }) => kind === "text").map(summary)}
      {status.data && !available.length && <EmptyState fill>No Services</EmptyState>}
    </Stack>
  );
}
/**
 * Settings › Workers: each worker's status first, then the GPU workloads Studio controls, then the
 * rarely changed parts: benchmarks and the change history.
 */
export function RuntimePanel() {
  const status = useQuery(servicesStatusQuery);
  if (status.isPending) return <LoadingState label="Loading Workers" />;
  if (status.error) return <Alert color="red">{status.error.message}</Alert>;
  const { runtime, services: observed, workers } = status.data;
  const workerStatus = workers && <WorkerList workers={workers} />;
  // An unhealthy endpoint's reason, shown on the workloads that serve it.
  const reasons = Object.fromEntries(
    Object.values(observed)
      .flatMap((service) => service.endpoints)
      .filter((endpoint) => endpoint.state !== "healthy" && endpoint.state !== "parked")
      .flatMap((endpoint) => (endpoint.workloads ?? []).map((id) => [id, endpoint.reason])),
  );
  return (
    <Stack gap="md" aria-label="Runtime">
      {runtime.configured ? (
        <RuntimeWorkloads reasons={reasons} workerStatus={workerStatus} />
      ) : (
        <>
          {workerStatus}
          <Text size="sm" c="dimmed">
            {runtime.reason}
          </Text>
        </>
      )}
      {runtime.configured && (
        <>
          <BenchmarkResults />
          <RuntimeHistory />
        </>
      )}
    </Stack>
  );
}
