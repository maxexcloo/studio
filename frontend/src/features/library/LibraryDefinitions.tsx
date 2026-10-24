import { useState } from "react";
import { Alert, Badge, Button, FileButton, Group, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { DefinitionEditor, type DefinitionKind, type LoadedDefinition } from "./DefinitionEditor";
interface DefinitionRow {
  id?: string;
  packId?: string;
  name?: string;
  family?: string;
  kind?: string;
  version: number;
  aiDrafted?: boolean;
}
export function LibraryDefinitions({ kind }: { kind: DefinitionKind }) {
  const list = useQuery({
    queryKey: ["definition-list", kind],
    queryFn: () =>
      api<{ profiles?: DefinitionRow[]; packs?: DefinitionRow[] }>(
        `/api/profiles/${kind === "profile" ? "editable" : "guides"}`,
      ),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<LoadedDefinition | null>(null);
  const records = list.data?.profiles || list.data?.packs || [];
  const ids = records.map((entry) => entry.id || entry.packId!);
  const importing = useMutation({
    meta: { inlineError: true },
    mutationFn: async (file: File) => {
      const workflow = JSON.parse(await file.text());
      const result = await post<{
        preview: {
          graph: unknown;
          detected: Record<string, unknown>;
          declared?: Record<string, unknown>;
          validation?: { issues?: string[]; warnings?: string[] };
          risks?: { reason: string; detail?: string }[];
        };
      }>("/api/workflows/import/preview", { workflow, filename: file.name });
      const { graph, detected, declared, validation, risks } = result.preview;
      const { nodes: _nodes, guessed: _guessed, ...detectedMetadata } = detected;
      const metadata = { ...declared, ...detectedMetadata };
      return {
        text: JSON.stringify({ heissUi: metadata, graph }, null, 2),
        blockName: "heissUi",
        hash: "",
        warnings: [
          ...(validation?.issues || []),
          ...(validation?.warnings || []),
          ...(risks || []).map((risk) => `${risk.reason}${risk.detail ? `: ${risk.detail}` : ""}`),
        ],
      };
    },
    onSuccess: (value) => {
      setSelected("");
      setCreating(value);
    },
  });
  const close = () => {
    setSelected(null);
    setCreating(null);
  };
  return (
    <Stack gap="md">
      <Group gap="xs" justify="flex-end">
        <Button
          component="a"
          href="/api/profiles/export"
          download
          variant="default"
          size="compact-sm"
        >
          Export Definitions
        </Button>
        {kind === "profile" ? (
          <FileButton
            accept="application/json,.json"
            onChange={(file) => {
              if (file) importing.mutate(file);
            }}
          >
            {(props) => (
              <Button {...props} size="compact-sm" loading={importing.isPending}>
                Import Workflow
              </Button>
            )}
          </FileButton>
        ) : (
          <Button
            size="compact-sm"
            onClick={() => {
              setSelected("");
              setCreating({ pack: { name: "", summary: "", rules: [] }, hash: "" });
            }}
          >
            New Guide
          </Button>
        )}
      </Group>
      {importing.error && <Alert color="red">{importing.error.message}</Alert>}
      {list.isPending ? (
        <LoadingState label="Loading Definitions" />
      ) : list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : !records.length ? (
        <EmptyState>{kind === "profile" ? "No Profiles" : "No Guides"}</EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={520}>
          <Table
            aria-label={kind === "profile" ? "Editable Profiles" : "Editable Guides"}
            verticalSpacing="sm"
            highlightOnHover
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Family</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {records.map((entry) => (
                <Table.Tr key={entry.id || entry.packId}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {entry.name || entry.packId || entry.id}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {entry.id || entry.packId}
                    </Text>
                  </Table.Td>
                  <Table.Td>{entry.family ? modelFamilyLabel(entry.family) : "—"}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{entry.version}</Text>
                      {entry.aiDrafted && (
                        <Badge color="orange" size="xs">
                          AI-Drafted
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="compact-sm"
                      variant="default"
                      onClick={() => setSelected(entry.id || entry.packId!)}
                    >
                      Edit {kind === "profile" ? "Profile" : "Guide"}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {selected !== null && (
        <DefinitionEditor
          kind={kind}
          id={selected}
          close={close}
          creating={creating || undefined}
          existingIds={ids}
        />
      )}
    </Stack>
  );
}
