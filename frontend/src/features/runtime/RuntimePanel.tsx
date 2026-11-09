import { Alert, Group, Stack, Text } from "@mantine/core";
import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Circle, CircleDot } from "lucide-react";
import type {
  ServiceHealth,
  ServiceStatus,
  ServicesStatus,
  WorkerStatus,
} from "../../../../shared/services";
import { api } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { AutomaticControl, RuntimeWorkloads } from "./RuntimeWorkloads";

const services = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Images" },
  { kind: "video", label: "Videos" },
] as const;
/** The status panel lists media first, as the queue above it does. */
const summaryKinds = [services[1], services[2], services[0]];
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

/** "11.2 GiB Free" from a worker's free memory in bytes. */
const gibFree = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB Free`;

/**
 * Each media worker on one compact line: its health dot and name, then what it runs, its state,
 * how much waits for it and its free memory. Its reason is the line's tooltip. Read-only: the
 * deployment lists the workers.
 */
function WorkerList({ workers }: { workers: WorkerStatus[] }) {
  return (
    <SettingGroup title="Workers">
      {workers.length ? (
        <Stack gap={0} component="ul" m={0} p={0} style={{ listStyle: "none" }}>
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
                    worker.state !== "healthy"
                      ? healthLabel(worker.state)
                      : worker.currentJob
                        ? "Busy"
                        : "Idle",
                    `${worker.queued} Queued`,
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
          The deployment lists no workers, so Studio can’t generate.
        </Text>
      )}
    </SettingGroup>
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
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
/** A media service's state: Stopped or another failing state, else how many workers run its jobs. */
const mediaState = (service: ServiceStatus) => {
  if (service.state !== "healthy") return healthLabel(service.state);
  const running = service.endpoints.filter((endpoint) => endpoint.running).length;
  return running ? `${running} running` : "Idle";
};
/**
 * The status panel's quiet summary, one line per kind: its health dot, then how many workers or
 * local models serve it and their state. Text without a local model runs in the cloud. Read-only
 * and the same for everyone; Settings › Workers holds the controls.
 */
export function ServiceHealthSummary() {
  const status = useQuery(servicesStatusQuery);
  if (status.error)
    return (
      <Text size="sm" c="red">
        {status.error.message}
      </Text>
    );
  const available = summaryKinds.filter(({ kind }) => status.data?.services[kind]);
  return (
    <Stack gap={4} component="section" aria-label="Service Status">
      {status.isPending && (
        <Text size="sm" c="dimmed">
          Checking Services
        </Text>
      )}
      {available.map(({ kind, label }) => {
        const service = status.data!.services[kind]!;
        const count = service.endpoints.length;
        const cloud = kind === "text" && !count;
        const detail = cloud
          ? "Cloud only"
          : kind === "text"
            ? `${plural(count, "local model")} · ${healthLabel(service.state)}`
            : `${plural(count, "worker")} · ${mediaState(service)}`;
        return (
          <Group key={kind} gap="xs" wrap="nowrap" aria-label={`${label}: ${detail}`}>
            <Circle
              size={10}
              strokeWidth={2.5}
              fill={cloud ? "none" : "currentColor"}
              style={{
                flexShrink: 0,
                color: `var(--mantine-color-${cloud ? "gray" : healthColour(service.state)}-6)`,
              }}
            />
            <Text size="sm" w={56}>
              {label}
            </Text>
            <Text size="sm" c="dimmed" title={service.reason}>
              {detail}
            </Text>
          </Group>
        );
      })}
      {status.data && !available.length && <EmptyState fill>No Services</EmptyState>}
    </Stack>
  );
}
/**
 * Settings › Workers: each worker's status first, then the GPU workloads Studio controls, then the
 * rarely changed parts: service health in one line, and automatic control.
 */
export function RuntimePanel() {
  const status = useQuery(servicesStatusQuery);
  if (status.isPending) return <LoadingState label="Loading Workers" />;
  if (status.error) return <Alert color="red">{status.error.message}</Alert>;
  const { runtime, services: observed } = status.data;
  // An unhealthy endpoint's reason, shown on the workloads that serve it.
  const reasons = Object.fromEntries(
    Object.values(observed)
      .flatMap((service) => service.endpoints)
      .filter((endpoint) => endpoint.state !== "healthy" && endpoint.state !== "parked")
      .flatMap((endpoint) => (endpoint.workloads ?? []).map((id) => [id, endpoint.reason])),
  );
  const shown = services.filter(({ kind }) => observed[kind]);
  return (
    <Stack gap="md" aria-label="Runtime">
      {status.data.workers && <WorkerList workers={status.data.workers} />}
      {runtime.configured ? (
        <RuntimeWorkloads reasons={reasons} />
      ) : (
        <Text size="sm" c="dimmed">
          {runtime.reason}
        </Text>
      )}
      <SettingGroup title="Services & Control">
        <SettingRow
          label="Services"
          description={
            // A service's reason is its tooltip; the workloads table carries the detail.
            <span role="status" aria-label="Services">
              {shown.length
                ? shown.map(({ kind, label }, index) => (
                    <span key={kind}>
                      {index > 0 && " · "}
                      <span title={observed[kind]!.reason}>
                        {`${label}: ${healthLabel(observed[kind]!.state)}`}
                      </span>
                    </span>
                  ))
                : "No Services"}
            </span>
          }
        />
        {runtime.configured && <AutomaticControl />}
      </SettingGroup>
    </Stack>
  );
}
