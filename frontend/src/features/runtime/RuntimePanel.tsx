import { Alert, Anchor, Badge, Group, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDot } from "lucide-react";
import type {
  ServiceEndpoint,
  ServiceHealth,
  ServiceStatus,
  ServicesStatus,
} from "../../../../shared/services";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";

const services = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Images" },
  { kind: "video", label: "Videos" },
] as const;
export const healthColour = (state: ServiceHealth) =>
  state === "healthy" ? "green" : state === "offline" ? "red" : "yellow";
const healthLabel = (state: ServiceHealth) =>
  ({ healthy: "Healthy", offline: "Offline", unknown: "Unknown", waiting: "Waiting" })[state];
export function useServicesStatus() {
  return useQuery({
    queryKey: ["services-status"],
    queryFn: () => api<ServicesStatus>("/api/services/status"),
    refetchInterval: 15000,
  });
}
export function summaryHealth(data?: ServicesStatus): ServiceHealth {
  const states = Object.values(data?.services || {}).map((service) => service.state);
  if (states.length === services.length && states.every((state) => state === "healthy"))
    return "healthy";
  return states.length && states.every((state) => state === "offline") ? "offline" : "unknown";
}
export function ServiceHealthSummary() {
  const status = useServicesStatus();
  if (status.isPending) return <LoadingState label="Checking Services" fill />;
  if (status.error)
    return (
      <Text size="xs" c="red">
        {status.error.message}
      </Text>
    );
  return (
    <Stack gap={6} component="section" aria-label="Service Status">
      {services
        .filter(({ kind }) => status.data.services[kind])
        .map(({ kind, label }) => {
          const service = status.data.services[kind]!;
          return (
            <Group
              key={kind}
              justify="space-between"
              gap="xs"
              aria-label={`${label}: ${healthLabel(service.state)}`}
            >
              <Group gap={6}>
                <CircleDot
                  size={12}
                  color={`var(--mantine-color-${healthColour(service.state)}-6)`}
                />
                <Text size="xs">{label}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {healthLabel(service.state)}
              </Text>
            </Group>
          );
        })}
      {!Object.keys(status.data.services).length && (
        <Text size="xs" c="dimmed">
          No services are available for this account.
        </Text>
      )}
    </Stack>
  );
}
const memory = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
function EndpointDetails({ endpoint }: { endpoint: ServiceEndpoint }) {
  return (
    <Stack gap={4} style={{ overflowWrap: "anywhere" }}>
      <Text size="xs" c="dimmed">
        {endpoint.reason}
      </Text>
      {endpoint.endpoint && (
        <Anchor
          size="xs"
          href={endpoint.endpoint}
          target="_blank"
          rel="noopener noreferrer"
          style={{ overflowWrap: "anywhere" }}
        >
          {endpoint.endpoint}
        </Anchor>
      )}
      {endpoint.loadedModel && <Text size="xs">Loaded Model: {endpoint.loadedModel}</Text>}
      {endpoint.device && <Text size="xs">Device: {endpoint.device}</Text>}
      {endpoint.version && <Text size="xs">Version: {endpoint.version}</Text>}
      {(endpoint.memoryTotal != null || endpoint.memoryFree != null) && (
        <Text size="xs">
          Memory:{" "}
          {[
            endpoint.memoryFree != null ? `${memory(endpoint.memoryFree)} Free` : null,
            endpoint.memoryTotal != null ? `${memory(endpoint.memoryTotal)} Total` : null,
          ]
            .filter(Boolean)
            .join(" / ")}
        </Text>
      )}
      {endpoint.workloadId && (
        <Text size="xs" c="dimmed">
          Configured Workload: {endpoint.workloadId}
        </Text>
      )}
      {!!endpoint.placements?.length && (
        <Text size="xs" c="dimmed">
          Supported Placements: {endpoint.placements.join(", ")}
        </Text>
      )}
      {endpoint.checkedAt && (
        <Text size="xs" c="dimmed">
          Checked: {new Date(endpoint.checkedAt).toLocaleString()}
        </Text>
      )}
    </Stack>
  );
}
function ServiceEndpointRow({ label, service }: { label: string; service: ServiceStatus }) {
  const [selection, setSelection] = useState<string | null>(null);
  const endpoint =
    service.endpoints.find((endpoint) => endpoint.id === selection) || service.endpoints[0];
  const state = endpoint?.state || "unknown";
  return (
    <Stack gap="xs">
      <Group gap="sm" align="end" wrap="nowrap">
        <Select
          label={label}
          aria-label={`${label} Endpoint`}
          placeholder="Unknown"
          disabled={!service.endpoints.length}
          data={service.endpoints.map((endpoint) => ({
            value: endpoint.id,
            label: endpoint.label,
          }))}
          value={endpoint?.id || null}
          onChange={setSelection}
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Badge variant="light" color={healthColour(state)} mb={8}>
          {healthLabel(state)}
        </Badge>
      </Group>
      {endpoint ? (
        <EndpointDetails endpoint={endpoint} />
      ) : (
        <Text size="xs" c="dimmed">
          {service.reason}
        </Text>
      )}
    </Stack>
  );
}
export function RuntimePanel({ compact = false }: { compact?: boolean }) {
  const status = useServicesStatus();
  if (status.isPending) return <LoadingState label="Loading Runtime" fill={compact} />;
  if (status.error) return <Alert color="red">{status.error.message}</Alert>;
  const available = services.filter(({ kind }) => status.data.services[kind]);
  return (
    <Stack gap={compact ? "sm" : "md"} aria-label="Runtime">
      <Group gap="xs">
        <Badge color="gray" variant="light">
          {status.data.runtime.configured ? "Runtime Configured" : "Observe Only"}
        </Badge>
        <Text size="xs" c="dimmed">
          Automatic Control {status.data.runtime.automaticLifecycle ? "On" : "Off"}
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        {status.data.runtime.reason}
      </Text>
      {available.map(({ kind, label }) => (
        <ServiceEndpointRow key={kind} label={label} service={status.data.services[kind]!} />
      ))}
      {!available.length && (
        <Text size="sm" c="dimmed">
          No services are available for this account.
        </Text>
      )}
    </Stack>
  );
}
