import { Alert, Anchor, Badge, Button, Group, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { queryOptions, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CircleDot } from "lucide-react";
import type {
  ServiceEndpoint,
  ServiceHealth,
  ServiceStatus,
  ServicesStatus,
} from "../../../../shared/services";
import { api } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeading } from "../../ui/SectionHeading";
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
const memory = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
/** What the endpoint reports, on one line. */
function endpointFacts(endpoint: ServiceEndpoint) {
  const memoryText = [
    endpoint.memoryFree != null ? `${memory(endpoint.memoryFree)} Free` : null,
    endpoint.memoryTotal != null ? `${memory(endpoint.memoryTotal)} Total` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  return [
    endpoint.loadedModel,
    endpoint.device,
    endpoint.version && `Version ${endpoint.version}`,
    memoryText,
    endpoint.checkedAt && `Checked ${new Date(endpoint.checkedAt).toLocaleTimeString()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
// Several text workloads may share a display label; the workload ID tells them apart.
const endpointLabel = (endpoint: ServiceEndpoint, endpoints: ServiceEndpoint[]) =>
  endpoints.filter((other) => other.label === endpoint.label).length > 1
    ? `${endpoint.label} · ${endpoint.id}`
    : endpoint.label;
/** One service: its health, the endpoint shown (chosen when there are several) and what it reports. */
function ServiceEndpointRow({ label, service }: { label: string; service: ServiceStatus }) {
  const [selection, setSelection] = useState<string | null>(null);
  const endpoint =
    service.endpoints.find((endpoint) => endpoint.id === selection) ||
    service.endpoints.find((endpoint) => endpoint.state === service.state) ||
    service.endpoints[0];
  const facts = endpoint && endpointFacts(endpoint);
  // A healthy service, or a reason that only repeats its badge, needs no explanation.
  const reason = endpoint?.reason || service.reason;
  const shown = endpoint?.state ?? service.state;
  const explained =
    shown !== "healthy" && reason.toLowerCase() !== healthLabel(shown).toLowerCase();
  return (
    <Stack gap={6} component="section" aria-label={label} style={{ overflowWrap: "anywhere" }}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>{label}</Text>
          <Badge color={healthColour(service.state)}>{healthLabel(service.state)}</Badge>
        </Group>
        {endpoint && (
          <Select
            aria-label={`${label} Endpoint`}
            size="xs"
            w={{ base: 160, sm: 240 }}
            data={service.endpoints.map((option) => ({
              value: option.id,
              label: endpointLabel(option, service.endpoints),
            }))}
            value={endpoint.id}
            onChange={setSelection}
            allowDeselect={false}
            leftSection={
              <CircleDot
                size={12}
                color={`var(--mantine-color-${healthColour(endpoint.state)}-6)`}
              />
            }
            renderOption={({ option }) => {
              const state = service.endpoints.find((item) => item.id === option.value)!.state;
              return (
                <Group gap="xs" wrap="nowrap">
                  <CircleDot size={12} color={`var(--mantine-color-${healthColour(state)}-6)`} />
                  <Text size="sm">{option.label}</Text>
                  <Text size="xs" c="dimmed" ml="auto">
                    {healthLabel(state)}
                  </Text>
                </Group>
              );
            }}
          />
        )}
      </Group>
      {explained && (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {reason}
          </Text>
          {endpoint?.state === "parked" && !!endpoint.workloads?.length && (
            <ParkedStart
              key={endpoint.id}
              label={endpointLabel(endpoint, service.endpoints)}
              workloads={endpoint.workloads}
            />
          )}
        </Group>
      )}
      {facts && <Text size="xs">{facts}</Text>}
      {endpoint?.endpoint && (
        <Anchor size="xs" href={endpoint.endpoint} target="_blank" rel="noopener noreferrer">
          {endpoint.endpoint}
        </Anchor>
      )}
    </Stack>
  );
}
export function RuntimePanel() {
  const status = useQuery(servicesStatusQuery);
  if (status.isPending) return <LoadingState label="Loading Workers" />;
  if (status.error) return <Alert color="red">{status.error.message}</Alert>;
  const available = services.filter(({ kind }) => status.data.services[kind]);
  const { runtime } = status.data;
  return (
    <Stack gap="lg" aria-label="Runtime">
      <Group gap="xs">
        <Badge color="gray">{runtime.configured ? "Runtime Configured" : "Observe Only"}</Badge>
        <Text size="xs" c="dimmed">
          Automatic Control {runtime.automaticLifecycle ? "On" : "Off"}
        </Text>
      </Group>
      {!runtime.configured && (
        <Text size="sm" c="dimmed">
          {runtime.reason}
        </Text>
      )}
      {runtime.configured && <RuntimeWorkloads />}
      <Stack gap="md" component="section" aria-label="Services">
        <SectionHeading>Services</SectionHeading>
        {available.map(({ kind, label }) => (
          <ServiceEndpointRow key={kind} label={label} service={status.data.services[kind]!} />
        ))}
        {!available.length && <EmptyState>No Services</EmptyState>}
      </Stack>
    </Stack>
  );
}
