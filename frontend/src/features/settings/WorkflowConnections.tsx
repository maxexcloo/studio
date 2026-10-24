import { Alert, Button, Select, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { post } from "../../api";
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
function MappingCells({
  mapping,
  nodes,
  label,
  disabled,
  readOnly,
  onChange,
}: {
  mapping: unknown;
  nodes: WorkflowNode[];
  label: string;
  disabled: boolean;
  readOnly?: boolean;
  onChange: (mapping: Record<string, unknown>) => void;
}) {
  if (!record(mapping))
    return (
      <Table.Td colSpan={2}>
        <Text size="xs" c="dimmed">
          Edit this mapping in Advanced JSON.
        </Text>
      </Table.Td>
    );
  const node = mapping.node == null || mapping.node === "" ? null : String(mapping.node);
  const input = mapping.input == null || mapping.input === "" ? null : String(mapping.input);
  const selected = nodes.find((entry) => entry.id === node);
  const nodeOptions = nodes.map((entry) => ({
    value: entry.id,
    label: `${entry.title || entry.classType} #${entry.id}`,
  }));
  if (node && !selected)
    nodeOptions.push({ value: node, label: disabled ? node : `${node} · Missing Node` });
  const inputOptions = (selected?.inputs || []).map((value) => ({ value, label: value }));
  if (input && !selected?.inputs.includes(input))
    inputOptions.push({ value: input, label: disabled ? input : `${input} · Missing Input` });
  return (
    <>
      <Table.Td>
        <Select
          aria-label={`${label} Node`}
          placeholder="Choose Node"
          searchable
          allowDeselect={false}
          data={nodeOptions}
          value={node}
          disabled={disabled || readOnly}
          onChange={(value) => {
            if (value !== null) onChange({ ...mapping, node: value });
          }}
        />
      </Table.Td>
      <Table.Td>
        <Select
          aria-label={`${label} Input`}
          placeholder="Choose Input"
          searchable
          allowDeselect={false}
          data={inputOptions}
          value={input}
          disabled={disabled || readOnly || !selected}
          onChange={(value) => {
            if (value !== null) onChange({ ...mapping, input: value });
          }}
        />
      </Table.Td>
    </>
  );
}

export function WorkflowConnections({
  id,
  raw,
  metadata,
  onChange,
}: {
  id: string;
  raw: Record<string, unknown>;
  metadata: Record<string, unknown>;
  onChange: (field: "controls" | "mediaInputs", value: unknown) => void;
}) {
  // This tab mounts anew after Advanced JSON editing; metadata-only changes keep the graph's choices.
  const preview = useQuery({
    queryKey: ["workflow-connections", id],
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
      <Table.ScrollContainer minWidth={580}>
        <Table aria-label="Control Connections" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Control</Table.Th>
              <Table.Th>Node</Table.Th>
              <Table.Th>Input</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(controls).map(([key, mapping]) => {
              const legacy = key === "startImage" && mediaInputs.length > 0;
              return (
                <Table.Tr key={key}>
                  <Table.Td>
                    <Text size="sm">{key}</Text>
                    {legacy && (
                      <Text size="xs" c="dimmed">
                        Reference inputs below take precedence.
                      </Text>
                    )}
                  </Table.Td>
                  <MappingCells
                    mapping={mapping}
                    nodes={nodes}
                    label={`Control ${key}`}
                    disabled={disabled}
                    readOnly={legacy}
                    onChange={(next) => onChange("controls", { ...controls, [key]: next })}
                  />
                </Table.Tr>
              );
            })}
            {!Object.keys(controls).length && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text size="sm" c="dimmed">
                    No existing control mappings. Add declarations in Advanced JSON.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!!mediaInputs.length && (
        <Table.ScrollContainer minWidth={580}>
          <Table aria-label="Reference Connections" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Node</Table.Th>
                <Table.Th>Input</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {mediaInputs.map((slot, index) => (
                <Table.Tr key={index}>
                  <Table.Td>
                    <Text size="sm">
                      {record(slot)
                        ? String(slot.label || slot.id || `Reference ${index + 1}`)
                        : `Reference ${index + 1}`}
                    </Text>
                    {record(slot) && (
                      <Text size="xs" c="dimmed">
                        {String(slot.id || "")}
                      </Text>
                    )}
                  </Table.Td>
                  <MappingCells
                    mapping={record(slot) ? slot.control : undefined}
                    nodes={nodes}
                    label={`Reference ${record(slot) ? String(slot.id || index + 1) : index + 1}`}
                    disabled={disabled}
                    onChange={(next) =>
                      onChange(
                        "mediaInputs",
                        mediaInputs.map((entry, entryIndex) =>
                          entryIndex === index ? { ...slot, control: next } : entry,
                        ),
                      )
                    }
                  />
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
