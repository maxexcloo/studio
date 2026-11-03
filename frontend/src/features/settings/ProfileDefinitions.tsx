import { useState, type ReactNode } from "react";
import { ActionIcon, Alert, Badge, Group, Menu, Select, Stack, Text, Tooltip } from "@mantine/core";
import { useFileDialog } from "@mantine/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Combine, FileDown, Merge, Plus, Upload, type LucideIcon } from "lucide-react";
import { icons } from "../../ui/icons";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { DataTable } from "../../ui/DataTable";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { usePhone } from "../../ui/usePhone";
import { DefinitionEditor, type DefinitionKind, type LoadedDefinition } from "./DefinitionEditor";
import { MergeDuplicateProfiles } from "./MergeDuplicateProfiles";
import { CombineBackends } from "./CombineBackends";
import { modelsQuery } from "../generation/GenerationProvider";

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
const kindLabels: Record<string, string> = { image: "Image", video: "Video" };

interface SectionAction {
  label: string;
  icon: LucideIcon;
  loading?: boolean;
  onClick?: () => void;
  /** A download link instead of a click. */
  href?: string;
}

/** Icons with tooltips on desktop; phones, which show no tooltips, list them by name under More. */
function SectionActions({ actions }: { actions: SectionAction[] }) {
  const phone = usePhone();
  const link = (href?: string) => (href ? { component: "a" as const, href, download: true } : {});
  if (phone)
    return (
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label="More Profile Actions">
            <icons.more size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {actions.map(({ label, icon: Icon, onClick, href }) => (
            <Menu.Item
              key={label}
              leftSection={<Icon size={16} />}
              onClick={onClick}
              {...link(href)}
            >
              {label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    );
  return actions.map(({ label, icon: Icon, loading, onClick, href }) => (
    <Tooltip key={label} label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={label}
        loading={loading}
        onClick={onClick}
        {...link(href)}
      >
        <Icon size={18} />
      </ActionIcon>
    </Tooltip>
  ));
}

/** Settings › Profiles: generation profiles and prompting guides, each with saved versions. */
interface ProfileStats {
  runs: number;
  failed: number;
  starred: number;
  medianRunMs?: number;
  failing: boolean;
}
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** Runs, failures, stars and typical time; Failing when most recent runs failed. */
function ProfileUse({ stats }: { stats?: ProfileStats }) {
  if (!stats)
    return (
      <Text size="xs" c="dimmed">
        No Runs
      </Text>
    );
  const done = stats.runs - stats.failed;
  return (
    <Group gap="xs" wrap="nowrap">
      {stats.failing && (
        <Badge color="red" size="sm">
          Failing
        </Badge>
      )}
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {[
          `${stats.runs} ${stats.runs === 1 ? "Run" : "Runs"}`,
          stats.failed && `${percent(stats.failed, stats.runs)} Failed`,
          done > 0 && `${percent(stats.starred, done)} Starred`,
          stats.medianRunMs && `${Math.round(stats.medianRunMs / 1000)} s`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Group>
  );
}

export function ProfileDefinitions({ heading }: { heading: ReactNode }) {
  const [kind, setKind] = useState<DefinitionKind>("profile");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<LoadedDefinition | null>(null);
  const [merging, setMerging] = useState(false);
  const [combining, setCombining] = useState(false);
  const noun = nouns[kind];
  // Family names come with the models list; following it re-labels once they arrive.
  useQuery(modelsQuery);
  const list = useQuery({
    queryKey: ["definition-list", kind],
    queryFn: () =>
      api<{ profiles?: DefinitionRow[]; packs?: DefinitionRow[] }>(
        `/api/profiles/${kind === "profile" ? "editable" : "guides"}`,
      ),
  });
  const stats = useQuery({
    queryKey: ["profile-stats"],
    queryFn: () => api<{ profiles: Record<string, ProfileStats> }>("/api/stats/profiles"),
    enabled: kind === "profile",
  }).data?.profiles;
  const records = list.data?.profiles || list.data?.packs || [];
  const idOf = (entry: DefinitionRow) => entry.id || entry.packId!;
  const families = [
    ...new Set(records.flatMap((entry) => (entry.family ? [entry.family] : []))),
  ].sort((a, b) => modelFamilyLabel(a).localeCompare(modelFamilyLabel(b)));
  const rows = family ? records.filter((entry) => entry.family === family) : records;
  // Runs record the runtime id, `custom:` plus the definition's id.
  const statsOf = (id: string) => stats?.[`custom:${id}`] || stats?.[id];
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
        text: JSON.stringify({ studio: metadata, graph }, null, 2),
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
  const workflowFile = useFileDialog({
    accept: "application/json,.json",
    multiple: false,
    onChange: (files) => {
      if (files?.[0]) importing.mutate(files[0]);
    },
  });
  const actions: SectionAction[] = [
    kind === "profile"
      ? {
          label: "Import Workflow",
          icon: Upload,
          loading: importing.isPending,
          onClick: workflowFile.open,
        }
      : {
          label: "New Guide",
          icon: Plus,
          onClick: () => {
            setSelected("");
            setCreating({ pack: { name: "", summary: "", rules: [] }, hash: "" });
          },
        },
    ...(kind === "profile"
      ? [
          { label: "Merge Duplicate Profiles", icon: Merge, onClick: () => setMerging(true) },
          { label: "Combine Backends", icon: Combine, onClick: () => setCombining(true) },
        ]
      : []),
    { label: "Export Definitions", icon: FileDown, href: "/api/profiles/export" },
  ];
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
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
          actions={<SectionActions actions={actions} />}
        />
      </SectionHeader>
      {importing.error && <Alert color="red">{importing.error.message}</Alert>}
      {list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : (
        <DataTable
          key={kind}
          label={`Editable ${noun}s`}
          rows={rows}
          rowKey={idOf}
          rowName={(entry) => entry.name || idOf(entry)}
          loading={list.isPending && `Loading ${noun}s`}
          query={query}
          searchText={(entry) => [
            entry.name,
            idOf(entry),
            entry.family && modelFamilyLabel(entry.family),
          ]}
          initialSort={{ key: "name", descending: false }}
          empty={records.length ? "No Matches" : `No ${noun}s`}
          columns={[
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: (entry) => entry.name || idOf(entry),
              // The name and its family wrap rather than cut off; Copy ID has the exact ID.
              cell: (entry) => (
                <>
                  <Text size="sm" fw={500} style={{ overflowWrap: "anywhere" }}>
                    {entry.name || idOf(entry)}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                    {[
                      entry.family && modelFamilyLabel(entry.family),
                      entry.kind && kindLabels[entry.kind],
                    ]
                      .filter(Boolean)
                      .join(" · ") || idOf(entry)}
                  </Text>
                </>
              ),
            },
            {
              key: "version",
              header: "Version",
              sortValue: (entry) => entry.version,
              cell: (entry) => (
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm">{entry.version}</Text>
                  {entry.aiDrafted && <Badge color="orange">AI-Drafted</Badge>}
                </Group>
              ),
            },
            ...(kind === "profile"
              ? [
                  {
                    key: "use",
                    header: "Last 30 Days",
                    visibleFrom: "md" as const,
                    sortValue: (entry: DefinitionRow) => statsOf(idOf(entry))?.runs,
                    cell: (entry: DefinitionRow) => <ProfileUse stats={statsOf(idOf(entry))} />,
                  },
                ]
              : []),
          ]}
          rowActions={(entry) => (
            <>
              <Menu.Item onClick={() => setSelected(idOf(entry))}>Edit {noun}</Menu.Item>
              <Menu.Item onClick={() => void copyText(idOf(entry), `${noun} ID`)}>
                Copy {noun} ID
              </Menu.Item>
            </>
          )}
        />
      )}
      <MergeDuplicateProfiles opened={merging} onClose={() => setMerging(false)} />
      <CombineBackends opened={combining} onClose={() => setCombining(false)} />
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
