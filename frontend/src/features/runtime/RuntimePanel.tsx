import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { queryOptions, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CircleDot } from "lucide-react";
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
import { useIsAdmin } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileName } from "../generation/payload";
import { RuntimeWorkloads } from "./RuntimeWorkloads";
import { useWorkloadStart } from "./WorkloadStart";

const services = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Images" },
  { kind: "video", label: "Videos" },
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
/** The workloads behind a service's parked endpoints, for an administrator's Start. */
const parkedWorkloads = (service: ServiceStatus) =>
  service.endpoints
    .filter((endpoint) => endpoint.state === "parked")
    .flatMap((endpoint) => endpoint.workloads ?? []);

/**
 * An administrator's Start for a parked service or endpoint, with its progress beneath: a free GPU
 * starts it at once, a switch that stops others asks first (useWorkloadStart).
 */
function ParkedStart({ label, workloads }: { label: string; workloads: string[] }) {
  const client = useQueryClient();
  const runtime = useWorkloadStart(true);
  const refresh = () => void client.invalidateQueries({ queryKey: servicesStatusQuery.queryKey });
  return (
    <Stack gap={2} align="flex-end">
      <Button
        size="compact-sm"
        variant="subtle"
        aria-label={`Start ${label}`}
        loading={Boolean(runtime.starting && !runtime.starting.error)}
        onClick={() => void runtime.start(workloads, label, refresh)}
      >
        Start
      </Button>
      {runtime.starting && (
        <Text size="xs" c={runtime.starting.error ? "red" : "dimmed"} ta="end" role="status">
          {runtime.starting.error
            ? `Couldn’t start ${label}: ${runtime.starting.error}`
            : runtime.starting.progress}
        </Text>
      )}
      {runtime.dialog}
    </Stack>
  );
}
/** The deployment's workers (backend/workers.js), which Studio lists but never edits. */
export const workersQuery = queryOptions({
  queryKey: ["workers"],
  queryFn: () =>
    api<{
      source: "STUDIO_WORKERS" | "Kubernetes";
      workers: { id: string; name: string; url: string; capabilities: string[] }[];
    }>("/api/workers"),
});
const capabilityLabels: Record<string, string> = {
  image: "Images",
  models: "Model Library",
  upscale: "Upscale",
  video: "Videos",
};

/** "Free in about 3 min" from a worker's `freeAt`. */
const freeIn = (freeAt: number) => {
  const minutes = Math.ceil((freeAt - Date.now()) / 60_000);
  return minutes <= 1 ? "Free in under a minute" : `Free in about ${minutes} min`;
};

/**
 * Each media worker with its health and work: what runs there, how much waits, the profile it last
 * ran, its free memory and when it should be free. Read-only: the deployment lists the workers, and
 * those in STUDIO_WORKERS show their address.
 */
function WorkerList({ workers }: { workers: WorkerStatus[] }) {
  const list = useQuery(workersQuery).data;
  const profiles = useQuery(modelsQuery).data?.profiles ?? [];
  const listed = list?.source === "STUDIO_WORKERS";
  const model = (id: string) => {
    const profile = profiles.find((profile) => profile.id === id);
    return profile ? profileName(profile) : id;
  };
  return (
    <SettingGroup title="Workers">
      <Text size="xs" c="dimmed">
        {workers.length
          ? `Listed by the deployment${listed ? " in STUDIO_WORKERS" : ""}. Studio doesn’t edit them.`
          : "The deployment lists no workers, so Studio can’t generate."}
      </Text>
      {workers.map((worker) => {
        const url = listed ? list.workers.find((item) => item.id === worker.id)?.url : undefined;
        const work = [
          healthLabel(worker.state),
          worker.currentJob ? "Busy" : "Idle",
          `${worker.queued} Queued`,
          worker.loadedModel && `Last Ran ${model(worker.loadedModel)}`,
          worker.memoryFree !== undefined &&
            `${(worker.memoryFree / 1024 ** 3).toFixed(1)} GiB Free`,
          worker.freeAt && freeIn(worker.freeAt),
        ].filter(Boolean);
        return (
          <SettingRow
            key={worker.id}
            label={worker.label}
            description={
              <>
                {[worker.capabilities.map((id) => capabilityLabels[id] || id).join(", "), url]
                  .filter(Boolean)
                  .join(" · ")}
                <br />
                <span title={worker.reason}>{work.join(" · ")}</span>
              </>
            }
          />
        );
      })}
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
/**
 * The status panel's service rows: each service's name on the left, its state and any Start on
 * the right, every row one compact bar's height whether or not it offers Start.
 */
export function ServiceHealthSummary() {
  const status = useQuery(servicesStatusQuery);
  const admin = useIsAdmin();
  if (status.error)
    return (
      <Text size="sm" c="red">
        {status.error.message}
      </Text>
    );
  const available = services.filter(({ kind }) => status.data?.services[kind]);
  return (
    <Stack gap={0} component="section" aria-label="Service Status">
      {status.isPending && (
        <Text size="sm" c="dimmed" lh="32px">
          Checking Services
        </Text>
      )}
      {available.map(({ kind, label }) => {
        const service = status.data!.services[kind]!;
        const parked = service.state === "parked" ? parkedWorkloads(service) : [];
        return (
          <Group
            key={kind}
            justify="space-between"
            gap="xs"
            wrap="nowrap"
            mih={32}
            aria-label={`${label}: ${healthLabel(service.state)}`}
          >
            <Group gap="xs" wrap="nowrap">
              <CircleDot
                size={12}
                color={`var(--mantine-color-${healthColour(service.state)}-6)`}
              />
              <Text size="sm">{label}</Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Text
                size="sm"
                c="dimmed"
                title={service.state === "parked" ? service.reason : undefined}
              >
                {healthLabel(service.state)}
              </Text>
              {admin && parked.length > 0 && <ParkedStart label={label} workloads={parked} />}
            </Group>
          </Group>
        );
      })}
      {status.data && !available.length && <EmptyState fill>No Services</EmptyState>}
    </Stack>
  );
}
/** Settings › Workers: one line of service health, then the GPU workloads Studio controls. */
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
      <Text size="sm" component="section" aria-label="Services">
        {/* A service's reason is its tooltip; the workloads table carries the detail. */}
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
      </Text>
      {runtime.configured ? (
        <RuntimeWorkloads reasons={reasons} />
      ) : (
        <Text size="sm" c="dimmed">
          {runtime.reason}
        </Text>
      )}
      {status.data.workers && <WorkerList workers={status.data.workers} />}
    </Stack>
  );
}
