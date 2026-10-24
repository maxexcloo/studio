import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  FileButton,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ellipsis, FileDown, Plus, Upload } from "lucide-react";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { SectionToolbar } from "../../ui/SectionToolbar";
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
const nouns = { profile: "Profile", guide: "Guide" } as const;

/** Settings › Profiles: generation profiles and prompting guides, each with saved versions. */
export function ProfileDefinitions() {
  const [kind, setKind] = useState<DefinitionKind>("profile");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<LoadedDefinition | null>(null);
  const noun = nouns[kind];
  const list = useQuery({
    queryKey: ["definition-list", kind],
    queryFn: () =>
      api<{ profiles?: DefinitionRow[]; packs?: DefinitionRow[] }>(
        `/api/profiles/${kind === "profile" ? "editable" : "guides"}`,
      ),
  });
  const records = list.data?.profiles || list.data?.packs || [];
  const idOf = (entry: DefinitionRow) => entry.id || entry.packId!;
  const families = [
    ...new Set(records.flatMap((entry) => (entry.family ? [entry.family] : []))),
  ].sort((a, b) => modelFamilyLabel(a).localeCompare(modelFamilyLabel(b)));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = records.filter((entry) => {
    if (family && entry.family !== family) return false;
    const text = [entry.name, idOf(entry), entry.family && modelFamilyLabel(entry.family)]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
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
      <SectionToolbar
        label={`${noun}s`}
        views={[
          { value: "profile", label: "Profiles" },
          { value: "guide", label: "Guides" },
        ]}
        view={kind}
        onViewChange={(value) => {
          setKind(value as DefinitionKind);
          setFamily(null);
        }}
        query={query}
        onQueryChange={setQuery}
        filters={
          <Select
            label="Family"
            placeholder="All Families"
            data={families.map((value) => ({ value, label: modelFamilyLabel(value) }))}
            value={family}
            onChange={setFamily}
            clearable
            searchable
            openOnFocus={false}
            comboboxProps={{ withinPortal: false }}
            data-mantine-stop-propagation
          />
        }
        filterCount={Number(!!family)}
        onResetFilters={() => setFamily(null)}
        actions={
          <>
            {kind === "profile" ? (
              <FileButton
                accept="application/json,.json"
                onChange={(file) => {
                  if (file) importing.mutate(file);
                }}
              >
                {(props) => (
                  <Tooltip label="Import Workflow">
                    <ActionIcon
                      {...props}
                      variant="subtle"
                      color="gray"
                      aria-label="Import Workflow"
                      loading={importing.isPending}
                    >
                      <Upload size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </FileButton>
            ) : (
              <Tooltip label="New Guide">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="New Guide"
                  onClick={() => {
                    setSelected("");
                    setCreating({ pack: { name: "", summary: "", rules: [] }, hash: "" });
                  }}
                >
                  <Plus size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Export Definitions">
              <ActionIcon
                component="a"
                href="/api/profiles/export"
                download
                variant="subtle"
                color="gray"
                aria-label="Export Definitions"
              >
                <FileDown size={18} />
              </ActionIcon>
            </Tooltip>
          </>
        }
      />
      {importing.error && <Alert color="red">{importing.error.message}</Alert>}
      {list.isPending ? (
        <LoadingState label={`Loading ${noun}s`} />
      ) : list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : !rows.length ? (
        <EmptyState title={records.length ? `No Matching ${noun}s` : `No ${noun}s`}>
          {records.length
            ? "Try another search or reset the filters."
            : kind === "profile"
              ? "Import a workflow, or draft one from a checkpoint in Library › Imports."
              : "Create a guide to steer the prompt assistant for a family."}
        </EmptyState>
      ) : (
        <Table aria-label={`Editable ${noun}s`} verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th visibleFrom="sm">Family</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((entry) => {
              const id = idOf(entry);
              const name = entry.name || id;
              return (
                <Table.Tr key={id}>
                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1} style={{ overflowWrap: "anywhere" }}>
                      {id}
                    </Text>
                  </Table.Td>
                  <Table.Td visibleFrom="sm">
                    <Text size="sm">{entry.family ? modelFamilyLabel(entry.family) : "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm">{entry.version}</Text>
                      {entry.aiDrafted && (
                        <Badge color="orange" variant="light" size="sm">
                          AI-Drafted
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`${noun} Actions for ${name}`}
                        >
                          <Ellipsis size={18} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => setSelected(id)}>Edit {noun}</Menu.Item>
                        <Menu.Item onClick={() => void copyText(id, `${noun} ID`)}>
                          Copy {noun} ID
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
      {selected !== null && (
        <DefinitionEditor
          kind={kind}
          id={selected}
          close={close}
          creating={creating || undefined}
          existingIds={records.map(idOf)}
        />
      )}
    </Stack>
  );
}
