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
import { SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";
import { DefinitionEditor, type DefinitionKind, type LoadedDefinition } from "./DefinitionEditor";
import { MergeDuplicateProfiles } from "./MergeDuplicateProfiles";
import { CombineBackends } from "./CombineBackends";
import { modelsQuery } from "../generation/GenerationProvider";

interface ProfileRow {
  id: string;
  name?: string;
  family?: string;
  kind?: string;
  version: number;
  aiDrafted?: boolean;
}
interface GuideRow {
  packId: string;
  version: number;
  aiDrafted?: boolean;
}
/** Which guide each profile uses: its own binding (by runtime id), else its family's for its kind. */
interface GuideBindings {
  families: Record<string, Record<string, string>>;
  profiles: Record<string, { pack?: string }>;
}
const kindLabels: Record<string, string> = { image: "Image", video: "Video" };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

interface MoreAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** A download link instead of a click. */
  href?: string;
}

/**
 * A group's toolbar actions: the rest as icons with tooltips (phones, which show no tooltips, list
 * them by name under More), then the labelled create action at the far right.
 */
function GroupActions({
  noun,
  more = [],
  children,
}: {
  noun: string;
  more?: MoreAction[];
  children: ReactNode;
}) {
  const phone = usePhone();
  const link = (href?: string) => (href ? { component: "a" as const, href, download: true } : {});
  return (
    <>
      {more.length > 0 &&
        (phone ? (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`More ${noun} Actions`}>
                <icons.more size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {more.map(({ label, icon: Icon, onClick, href }) => (
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
        ) : (
          more.map(({ label, icon: Icon, onClick, href }) => (
            <Tooltip key={label} label={label}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={label}
                onClick={onClick}
                {...link(href)}
              >
                <Icon size={18} />
              </ActionIcon>
            </Tooltip>
          ))
        ))}
      {children}
    </>
  );
}

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

function Version({ version, aiDrafted }: { version: number; aiDrafted?: boolean }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm">{version}</Text>
      {aiDrafted && <Badge color="orange">AI-Drafted</Badge>}
    </Group>
  );
}

/** The definition editor that is open: an existing ID, or "" with `creating` for a new one. */
interface Editing {
  kind: DefinitionKind;
  id: string;
  creating?: LoadedDefinition;
}

/**
 * Settings › Profiles: generation profiles, then the prompting guides they use, each a group with
 * its own toolbar and saved versions.
 */
export function ProfileDefinitions({ heading }: { heading: ReactNode }) {
  const [profileQuery, setProfileQuery] = useState("");
  const [guideQuery, setGuideQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [merging, setMerging] = useState(false);
  const [combining, setCombining] = useState(false);
  // Family names come with the models list; following it re-labels once they arrive.
  useQuery(modelsQuery);
  // Under "definition-list", which every editor save refreshes.
  const profileList = useQuery({
    queryKey: ["definition-list", "profile"],
    queryFn: () => api<{ profiles: ProfileRow[] }>("/api/profiles/editable"),
  });
  const guideList = useQuery({
    queryKey: ["definition-list", "guide"],
    queryFn: () => api<{ packs: GuideRow[] }>("/api/profiles/guides"),
  });
  const bindings = useQuery({
    queryKey: ["definition-list", "guide-bindings"],
    queryFn: () => api<{ bindings: GuideBindings }>("/api/profiles/guide-bindings"),
  }).data?.bindings;
  const stats = useQuery({
    queryKey: ["profile-stats"],
    queryFn: () => api<{ profiles: Record<string, ProfileStats> }>("/api/stats/profiles"),
  }).data?.profiles;
  const profiles = profileList.data?.profiles || [];
  const guides = guideList.data?.packs || [];
  const families = [
    ...new Set(profiles.flatMap((entry) => (entry.family ? [entry.family] : []))),
  ].sort((a, b) => modelFamilyLabel(a).localeCompare(modelFamilyLabel(b)));
  const profileRows = family ? profiles.filter((entry) => entry.family === family) : profiles;
  // Runs and guide bindings record the runtime id, `custom:` plus the definition's id.
  const statsOf = (id: string) => stats?.[`custom:${id}`] || stats?.[id];
  const guideOf = (entry: ProfileRow) =>
    bindings?.profiles[`custom:${entry.id}`]?.pack ??
    (entry.family ? bindings?.families[entry.family]?.[entry.kind || "image"] : undefined);
  const users = new Map<string, number>();
  for (const entry of profiles) {
    const guide = guideOf(entry);
    if (guide) users.set(guide, (users.get(guide) || 0) + 1);
  }
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
    onSuccess: (creating) => setEditing({ kind: "profile", id: "", creating }),
  });
  const workflowFile = useFileDialog({
    accept: "application/json,.json",
    multiple: false,
    onChange: (files) => {
      if (files?.[0]) importing.mutate(files[0]);
    },
  });
  const rowMenu = (kind: DefinitionKind, noun: string, id: string) => (
    <>
      <Menu.Item onClick={() => setEditing({ kind, id })}>Edit {noun}</Menu.Item>
      <Menu.Item onClick={() => void copyText(id, `${noun} ID`)}>Copy {noun} ID</Menu.Item>
    </>
  );
  return (
    <Stack gap="lg">
      {heading}
      <SettingGroup
        title="Profiles"
        toolbar={
          <SectionToolbar
            label="Profiles"
            query={profileQuery}
            onQueryChange={setProfileQuery}
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
              <GroupActions
                noun="Profile"
                more={[
                  {
                    label: "Merge Duplicate Profiles",
                    icon: Merge,
                    onClick: () => setMerging(true),
                  },
                  { label: "Combine Backends", icon: Combine, onClick: () => setCombining(true) },
                  // The bundle holds the guides too.
                  { label: "Export Definitions", icon: FileDown, href: "/api/profiles/export" },
                ]}
              >
                <ToolbarAction
                  label="Import Workflow"
                  icon={<Upload size={18} />}
                  loading={importing.isPending}
                  onClick={workflowFile.open}
                />
              </GroupActions>
            }
          />
        }
      >
        <Stack gap="xs">
          {importing.error && <Alert color="red">{importing.error.message}</Alert>}
          {profileList.error ? (
            <Alert color="red">{profileList.error.message}</Alert>
          ) : (
            <DataTable
              label="Editable Profiles"
              rows={profileRows}
              rowKey={(entry) => entry.id}
              rowName={(entry) => entry.name || entry.id}
              loading={profileList.isPending && "Loading Profiles"}
              query={profileQuery}
              searchText={(entry) => [
                entry.name,
                entry.id,
                entry.family && modelFamilyLabel(entry.family),
                guideOf(entry),
              ]}
              initialSort={{ key: "name", descending: false }}
              empty={profiles.length ? "No Matches" : "No Profiles"}
              columns={[
                {
                  key: "name",
                  header: "Name",
                  main: true,
                  sortValue: (entry) => entry.name || entry.id,
                  // The name and its family wrap rather than cut off; Copy ID has the exact ID.
                  cell: (entry) => (
                    <>
                      <Text size="sm" fw={500} style={{ overflowWrap: "anywhere" }}>
                        {entry.name || entry.id}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                        {[
                          entry.family && modelFamilyLabel(entry.family),
                          entry.kind && kindLabels[entry.kind],
                        ]
                          .filter(Boolean)
                          .join(" · ") || entry.id}
                      </Text>
                      <Text size="xs" c="dimmed" hiddenFrom="sm">
                        {guideOf(entry) ? `Guide: ${guideOf(entry)}` : "No Guide"}
                      </Text>
                    </>
                  ),
                },
                {
                  key: "guide",
                  header: "Guide",
                  visibleFrom: "sm",
                  sortValue: guideOf,
                  cell: (entry) => (
                    <Text size="sm" c={guideOf(entry) ? undefined : "dimmed"}>
                      {guideOf(entry) || "None"}
                    </Text>
                  ),
                },
                {
                  key: "version",
                  header: "Version",
                  sortValue: (entry) => entry.version,
                  cell: (entry) => <Version {...entry} />,
                },
                {
                  key: "use",
                  header: "Last 30 Days",
                  visibleFrom: "md",
                  sortValue: (entry) => statsOf(entry.id)?.runs,
                  cell: (entry) => <ProfileUse stats={statsOf(entry.id)} />,
                },
              ]}
              rowActions={(entry) => rowMenu("profile", "Profile", entry.id)}
            />
          )}
        </Stack>
      </SettingGroup>
      <SettingGroup
        title="Guides"
        toolbar={
          <SectionToolbar
            label="Guides"
            query={guideQuery}
            onQueryChange={setGuideQuery}
            actions={
              <GroupActions noun="Guide">
                <ToolbarAction
                  label="New Guide"
                  icon={<Plus size={18} />}
                  onClick={() =>
                    setEditing({
                      kind: "guide",
                      id: "",
                      creating: { pack: { name: "", summary: "", rules: [] }, hash: "" },
                    })
                  }
                />
              </GroupActions>
            }
          />
        }
      >
        {guideList.error ? (
          <Alert color="red">{guideList.error.message}</Alert>
        ) : (
          <DataTable
            label="Editable Guides"
            rows={guides}
            rowKey={(entry) => entry.packId}
            rowName={(entry) => entry.packId}
            loading={guideList.isPending && "Loading Guides"}
            query={guideQuery}
            searchText={(entry) => [entry.packId]}
            initialSort={{ key: "name", descending: false }}
            empty={guides.length ? "No Matches" : "No Guides"}
            columns={[
              {
                key: "name",
                header: "Name",
                main: true,
                sortValue: (entry) => entry.packId,
                cell: (entry) => (
                  <Text size="sm" fw={500} style={{ overflowWrap: "anywhere" }}>
                    {entry.packId}
                  </Text>
                ),
              },
              {
                key: "profiles",
                header: "Used By",
                sortValue: (entry) => users.get(entry.packId) || 0,
                cell: (entry) => (
                  <Text size="sm" c={users.has(entry.packId) ? undefined : "dimmed"}>
                    {users.has(entry.packId)
                      ? plural(users.get(entry.packId)!, "Profile")
                      : "No Profiles"}
                  </Text>
                ),
              },
              {
                key: "version",
                header: "Version",
                sortValue: (entry) => entry.version,
                cell: (entry) => <Version {...entry} />,
              },
            ]}
            rowActions={(entry) => rowMenu("guide", "Guide", entry.packId)}
          />
        )}
      </SettingGroup>
      <MergeDuplicateProfiles opened={merging} onClose={() => setMerging(false)} />
      <CombineBackends opened={combining} onClose={() => setCombining(false)} />
      {editing && (
        <DefinitionEditor
          kind={editing.kind}
          id={editing.id}
          close={() => setEditing(null)}
          creating={editing.creating}
          existingIds={
            editing.kind === "profile"
              ? profiles.map((entry) => entry.id)
              : guides.map((entry) => entry.packId)
          }
        />
      )}
    </Stack>
  );
}
