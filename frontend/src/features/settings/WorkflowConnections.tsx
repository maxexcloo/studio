import { Alert, Button, Select, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { post } from "../../api";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";

interface WorkflowNode {
  id: string;
  classType: string;
  title?: string;
  inputs: string[];
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
interface Connection {
  key: string;
  label: string;
  /** Names the row's node and input selectors. */
  field: string;
  detail?: string;
  mapping: unknown;
  readOnly?: boolean;
  onChange: (mapping: Record<string, unknown>) => void;
}

/** One control or reference per row, choosing the workflow node and input it feeds. */
function ConnectionTable({
  label,
  heading,
  rows,
  nodes,
  disabled,
  empty,
}: {
  label: string;
  heading: string;
  rows: Connection[];
  nodes: WorkflowNode[];
  disabled: boolean;
  empty: string;
}) {
  const nodeOf = (mapping: Record<string, unknown>) =>
    mapping.node == null || mapping.node === "" ? null : String(mapping.node);
  const inputOf = (mapping: Record<string, unknown>) =>
    mapping.input == null || mapping.input === "" ? null : String(mapping.input);
  const nodeOptions = (mapping: Record<string, unknown>) => {
    const node = nodeOf(mapping);
    const options = nodes.map((entry) => ({
      value: entry.id,
      label: `${entry.title || entry.classType} #${entry.id}`,
    }));
    if (node && !nodes.some((entry) => entry.id === node))
      options.push({ value: node, label: disabled ? node : `${node} · Missing Node` });
    return options;
  };
  const selectedNode = (mapping: Record<string, unknown>) =>
    nodes.find((entry) => entry.id === nodeOf(mapping));
  const inputOptions = (mapping: Record<string, unknown>) => {
    const input = inputOf(mapping);
    const inputs = selectedNode(mapping)?.inputs || [];
    const options = inputs.map((value) => ({ value, label: value }));
    if (input && !inputs.includes(input))
      options.push({ value: input, label: disabled ? input : `${input} · Missing Input` });
    return options;
  };
  return (
    <DataTable
      label={label}
      rows={rows}
      rowKey={(row) => row.key}
      rowName={(row) => row.label}
      empty={empty}
      minWidth={580}
      columns={[
        {
          key: "connection",
          header: heading,
          cell: (row) => (
            <>
              <Text size="sm">{row.label}</Text>
              {row.detail && (
                <Text size="xs" c="dimmed">
                  {row.detail}
                </Text>
              )}
            </>
          ),
        },
        {
          key: "node",
          header: "Node",
          cell: ({ field, mapping, readOnly, onChange }) =>
            record(mapping) ? (
              <Select
                aria-label={`${field} Node`}
                placeholder="Choose Node"
                searchable
                allowDeselect={false}
                data={nodeOptions(mapping)}
                value={nodeOf(mapping)}
                disabled={disabled || readOnly}
                onChange={(value) => {
                  if (value !== null) onChange({ ...mapping, node: value });
                }}
              />
            ) : (
              <Text size="xs" c="dimmed">
                Edit this mapping in Advanced JSON.
              </Text>
            ),
        },
        {
          key: "input",
          header: "Input",
          cell: ({ field, mapping, readOnly, onChange }) =>
            record(mapping) && (
              <Select
                aria-label={`${field} Input`}
                placeholder="Choose Input"
                searchable
                allowDeselect={false}
                data={inputOptions(mapping)}
                value={inputOf(mapping)}
                disabled={disabled || readOnly || !selectedNode(mapping)}
                onChange={(value) => {
                  if (value !== null) onChange({ ...mapping, input: value });
                }}
              />
            ),
        },
      ]}
    />
  );
}

export function WorkflowConnections({
  id,
  backend = "",
  raw,
  metadata,
  onChange,
}: {
  id: string;
  /** A combined profile's backend, whose graph `raw` holds. */
  backend?: string;
  raw: Record<string, unknown>;
  metadata: Record<string, unknown>;
  onChange: (field: "controls" | "mediaInputs", value: unknown) => void;
}) {
  // This tab mounts anew after Advanced JSON editing; metadata-only changes keep the graph's choices.
  const preview = useQuery({
    queryKey: ["workflow-connections", id, backend],
    queryFn: async () =>
      (
        await post<{ preview: { detected: { nodes: WorkflowNode[] } } }>(
          "/api/workflows/import/preview",
          { workflow: raw, filename: `${id}.json` },
        )
      ).preview.detected.nodes,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const nodes = preview.data || [];
  const controls = record(metadata.controls) ? metadata.controls : {};
  const mediaInputs = Array.isArray(metadata.mediaInputs) ? metadata.mediaInputs : [];
  const disabled = preview.isPending || preview.isError;
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Connect the profile’s existing controls and reference inputs to workflow nodes. Other inputs
        keep their saved values.
      </Text>
      {preview.isPending && <LoadingState label="Reading Workflow Connections" />}
      {preview.error && (
        <Alert color="red" title="Could Not Read Workflow Connections">
          <Stack gap="xs">
            <Text size="sm">{preview.error.message}</Text>
            <Button variant="default" size="compact-sm" onClick={() => void preview.refetch()}>
              Retry Connections
            </Button>
          </Stack>
        </Alert>
      )}
      <ConnectionTable
        label="Control Connections"
        heading="Control"
        nodes={nodes}
        disabled={disabled}
        empty="No Control Mappings"
        rows={Object.entries(controls).map(([key, mapping]) => {
          const legacy = key === "startImage" && mediaInputs.length > 0;
          return {
            key,
            label: key,
            field: `Control ${key}`,
            detail: legacy ? "Reference inputs below take precedence." : undefined,
            mapping,
            readOnly: legacy,
            onChange: (next) => onChange("controls", { ...controls, [key]: next }),
          };
        })}
      />
      {!!mediaInputs.length && (
        <ConnectionTable
          label="Reference Connections"
          heading="Reference"
          nodes={nodes}
          disabled={disabled}
          empty="No Reference Inputs"
          rows={mediaInputs.map((slot, index) => ({
            key: `${index}`,
            label: record(slot)
              ? String(slot.label || slot.id || `Reference ${index + 1}`)
              : `Reference ${index + 1}`,
            field: `Reference ${record(slot) ? String(slot.id || index + 1) : index + 1}`,
            detail: record(slot) ? String(slot.id || "") : undefined,
            mapping: record(slot) ? slot.control : undefined,
            onChange: (next) =>
              onChange(
                "mediaInputs",
                mediaInputs.map((entry, entryIndex) =>
                  entryIndex === index ? { ...slot, control: next } : entry,
                ),
              ),
          }))}
        />
      )}
    </Stack>
  );
}
