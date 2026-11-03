import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { queryOptions, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CircleDot } from "lucide-react";
import type { ServiceHealth, ServiceStatus, ServicesStatus } from "../../../../shared/services";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { useIsAdmin } from "../auth/AccountGate";
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
    healthy: "Healthy",
    offline: "Offline",
    parked: "Parked",
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
  if (!states.length) return { colour: "gray", label: "Services Parked" };
  if (states.every((state) => state === "healthy"))
    return {
      colour: "green",
      label: states.length < all.length ? "Services Healthy · Some Parked" : "Services Healthy",
    };
  if (states.every((state) => state === "offline" || state === "unknown"))
    return { colour: "red", label: "Services Unavailable" };
  return { colour: "yellow", label: "Services Partly Available" };
}
export function ServiceHealthSummary() {
  const status = useQuery(servicesStatusQuery);
  const admin = useIsAdmin();
  if (status.error)
    return (
      <Text size="xs" c="red">
        {status.error.message}
      </Text>
    );
  const available = services.filter(({ kind }) => status.data?.services[kind]);
  return (
    <Stack gap={6} component="section" aria-label="Service Status">
      {status.isPending && (
        <Text size="xs" c="dimmed">
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
            aria-label={`${label}: ${healthLabel(service.state)}`}
          >
            <Group gap={6} wrap="nowrap">
              <CircleDot
                size={12}
                color={`var(--mantine-color-${healthColour(service.state)}-6)`}
              />
              <Text size="xs">{label}</Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Text
                size="xs"
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
      {status.data && !available.length && (
        <Text size="xs" c="dimmed">
          No Services
        </Text>
      )}
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
  return (
    <Stack gap="lg" aria-label="Runtime">
      <Text size="sm" component="section" aria-label="Services">
        {services
          .filter(({ kind }) => observed[kind])
          .map(({ kind, label }) => {
            const { state, reason } = observed[kind]!;
            const healthy = state === "healthy" || state === "parked";
            return `${label}: ${healthLabel(state)}${healthy ? "" : ` (${reason})`}`;
          })
          .join(" · ") || "No Services"}
      </Text>
      {runtime.configured ? (
        <RuntimeWorkloads reasons={reasons} />
      ) : (
        <Text size="sm" c="dimmed">
          {runtime.reason}
        </Text>
      )}
    </Stack>
  );
}
