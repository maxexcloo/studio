import { Alert, Badge, Button, Group, Menu, Popover, Stack, Text } from "@mantine/core";
import { useFileDialog } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";

import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable, compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { plural } from "../../ui/plural";
import {
  FilterChoices,
  SectionHeader,
  SectionToolbar,
  ToolbarAction,
} from "../../ui/SectionToolbar";
import { usePhone, useTouch } from "../../ui/usePhone";
import { modelsQuery } from "../generation/GenerationProvider";
import { modelFamilyLabel } from "../generation/modelFamily";
import { ConvertToRadiance } from "./ConvertToRadiance";
import {
  DefinitionEditor,
  type DefinitionKind,
  type LoadedDefinition,
  definitionPath,
} from "./DefinitionEditor";
import {
  type ProfileRow,
  type ProfileStats,
  definitionsKey,
  editableProfilesQuery,
  profileStatsQuery,
} from "./queries";
interface GuideRow {
  packId: string;
  /** The pack's name, else the label of a family it guides, else its id (GET /api/profiles/guides). */
  name: string;
  version: number;
  aiDrafted?: boolean;
}
/** Which guide each profile uses: its own binding (by runtime id), else its family's for its kind. */
interface GuideBindings {
  families: Record<string, Record<string, string>>;
  profiles: Record<string, { pack?: string }>;
}
const kindLabels: Record<string, string> = { image: "Image", video: "Video" };

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** Runs, failures, likes and typical time; Failing when most recent runs failed. */
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
          done > 0 && `${percent(stats.liked, done)} Liked`,
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
      <Text size="sm">v{version}</Text>
      {aiDrafted && <Badge color="orange">AI</Badge>}
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
 * The profiles and guides with the guide each profile uses, shared by Library › Profiles and
 * Library › Guides; every editor save refreshes them under "definition-list".
 */
function useDefinitions() {
  // Family names come with the models list; following it re-labels once they arrive.
  useQuery(modelsQuery);
  const profileList = useQuery(editableProfilesQuery);
  const guideList = useQuery({
    queryKey: [...definitionsKey, "guide"],
    queryFn: () => api<{ packs: GuideRow[] }>("/api/profiles/guides"),
  });
  const bindings = useQuery({
    queryKey: [...definitionsKey, "guide-bindings"],
    queryFn: () => api<{ bindings: GuideBindings }>("/api/profiles/guide-bindings"),
  }).data?.bindings;
  const profiles = profileList.data?.profiles || [];
  const guides = guideList.data?.packs || [];
  // Guide bindings record the runtime id, `custom:` plus the definition's id.
  const guideIdOf = (entry: ProfileRow) =>
    bindings?.profiles[`custom:${entry.id}`]?.pack ??
    (entry.family ? bindings?.families[entry.family]?.[entry.kind || "image"] : undefined);
  const guideNames = new Map(guides.map((entry) => [entry.packId, entry.name]));
  const guideOf = (entry: ProfileRow) => {
    const id = guideIdOf(entry);
    return id && (guideNames.get(id) || id);
  };
  // Each guide's profiles, by name.
  const users = new Map<string, string[]>();
  for (const entry of profiles) {
    const guide = guideIdOf(entry);
    if (guide) users.set(guide, [...(users.get(guide) || []), entry.name || entry.id]);
  }
  return { profileList, guideList, profiles, guides, guideOf, users };
}

/** The definition a row menu's Delete is confirming. */
interface Deleting {
  kind: DefinitionKind;
  id: string;
  name: string;
}

/**
 * A profile's or guide's row menu: Edit, then the rest A–Z (Copy ID, Download, Duplicate… and any
 * `more`), then Delete.
 */
function rowMenu({
  kind,
  id,
  name,
  edit,
  remove,
  duplicate,
  more,
}: Deleting & {
  edit: (editing: Editing) => void;
  remove: (deleting: Deleting) => void;
  duplicate?: () => void;
  more?: ReactNode;
}) {
  return (
    <>
      <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => edit({ kind, id })}>
        Edit
      </Menu.Item>
      <Menu.Divider />
      {more}
      <Menu.Item
        leftSection={<icons.copy size={16} />}
        onClick={() => void copyText(id, kind === "guide" ? "Guide ID" : "Profile ID")}
      >
        Copy ID
      </Menu.Item>
      <Menu.Item
        leftSection={<icons.download size={16} />}
        component="a"
        href={`${definitionPath(kind, id)}/download`}
        download={`${id}.json`}
      >
        Download
      </Menu.Item>
      {duplicate && (
        <Menu.Item leftSection={<icons.duplicate size={16} />} onClick={duplicate}>
          Duplicate…
        </Menu.Item>
      )}
      <Menu.Divider />
      <Menu.Item
        color="red"
        leftSection={<icons.delete size={16} />}
        onClick={() => remove({ kind, id, name })}
      >
        Delete
      </Menu.Item>
    </>
  );
}

/**
 * Delete from a row menu: removes the definition over the hash it reads first, as the editor's
 * Delete does. A guide still in use stays, and the server says so.
 */
function DeleteDefinition({ deleting, close }: { deleting: Deleting | null; close: () => void }) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: async ({ kind, id }: Deleting) => {
      const { hash } = await api<LoadedDefinition>(definitionPath(kind, id));
      return post(`${definitionPath(kind, id)}/remove`, { baseHash: hash });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: definitionsKey });
      void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
      close();
    },
  });
  return (
    <ConfirmDialog
      opened={Boolean(deleting)}
      title={`Delete ${deleting?.kind === "guide" ? "Guide" : "Profile"}`}
      action="Delete"
      pending={remove.isPending}
      error={remove.error?.message}
      onConfirm={() => deleting && remove.mutate(deleting)}
      onClose={() => {
        close();
        remove.reset();
      }}
    >
      {deleting?.kind === "guide"
        ? `Delete ${deleting.name}? Its version history keeps it restorable. A guide that profiles still use stays until they use another.`
        : `Delete ${deleting?.name}? Its version history keeps it restorable; gallery items made with it stay.`}
    </ConfirmDialog>
  );
}

/** Library › Profiles: generation profiles under the section's toolbar; each keeps its saved versions. */
export function ProfileDefinitions({ heading }: { heading: ReactNode }) {
  const phone = usePhone();
  const [profileQuery, setProfileQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [converting, setConverting] = useState<ProfileRow | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const { profileList, profiles, guideOf } = useDefinitions();
  const stats = useQuery(profileStatsQuery).data?.profiles;
  const families = [
    ...new Set(profiles.flatMap((entry) => (entry.family ? [entry.family] : []))),
  ].sort((a, b) => compareNames(modelFamilyLabel(a), modelFamilyLabel(b)));
  const profileRows = family ? profiles.filter((entry) => entry.family === family) : profiles;
  // Runs record the runtime id, `custom:` plus the definition's id.
  const statsOf = (id: string) => stats?.[`custom:${id}`] || stats?.[id];
  // A copy of the profile's file under `<id>-copy` (or the next free `<id>-copy-<n>`), named
  // "… Copy", opened in the editor to create.
  const duplicating = useMutation({
    meta: { inlineError: true },
    mutationFn: async (id: string) => {
      const { text } = await api<{ text: string }>(definitionPath("profile", id));
      const raw = JSON.parse(text);
      const taken = new Set(profiles.map((entry) => entry.id));
      let copied = `${id}-copy`;
      for (let n = 2; taken.has(copied); n++) copied = `${id}-copy-${n}`;
      const studio = { ...raw.studio, id: copied, name: `${raw.studio?.name || id} Copy` };
      return { id: copied, text: `${JSON.stringify({ ...raw, studio }, null, 2)}\n` };
    },
    onSuccess: ({ id, text }) => setEditing({ kind: "profile", id, creating: { text, hash: "" } }),
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
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Profiles"
          query={profileQuery}
          onQueryChange={setProfileQuery}
          filters={
            <FilterChoices
              label="Family"
              data={families.map((value) => ({ value, label: modelFamilyLabel(value) }))}
              value={family}
              onChange={setFamily}
            />
          }
          filterCount={Number(!!family)}
          onClearFilters={() => setFamily(null)}
          more={[
            // Every profile and guide, in one archive.
            { label: "Download All", icon: icons.download, href: "/api/profiles/export" },
          ]}
          actions={
            <ToolbarAction
              label="Import Workflow"
              icon={icons.upload}
              loading={importing.isPending}
              onClick={workflowFile.open}
            />
          }
        />
      </SectionHeader>
      <Stack gap="xs">
        {importing.error && <Alert color="red">{importing.error.message}</Alert>}
        {duplicating.error && <Alert color="red">{duplicating.error.message}</Alert>}
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
                    {phone && (
                      <Group gap="xs" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {`${guideOf(entry) ? `Guide: ${guideOf(entry)}` : "No Guide"} · v${entry.version}`}
                        </Text>
                        {entry.aiDrafted && <Badge color="orange">AI</Badge>}
                      </Group>
                    )}
                  </>
                ),
              },
              {
                key: "guide",
                header: "Guide",
                hideOnPhone: true,
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
                hideOnPhone: true,
                sortValue: (entry) => entry.version,
                cell: (entry) => <Version {...entry} />,
              },
              {
                key: "use",
                header: "Last 30 Days",
                hideOnPhone: true,
                sortValue: (entry) => statsOf(entry.id)?.runs,
                cell: (entry) => <ProfileUse stats={statsOf(entry.id)} />,
              },
            ]}
            rowActions={(entry) => (
              <>
                {rowMenu({
                  kind: "profile",
                  id: entry.id,
                  name: entry.name || entry.id,
                  edit: setEditing,
                  remove: setDeleting,
                  duplicate: () => duplicating.mutate(entry.id),
                  // A Krea 2 profile on ComfyUI can take a converted Radiance backend, or a newer one.
                  more: entry.family === "krea2" && entry.kind === "image" && (
                    <Menu.Item leftSection={<Zap size={16} />} onClick={() => setConverting(entry)}>
                      Convert to Radiance…
                    </Menu.Item>
                  ),
                })}
              </>
            )}
          />
        )}
      </Stack>
      <ConvertToRadiance profile={converting} onClose={() => setConverting(null)} />
      <DeleteDefinition deleting={deleting} close={() => setDeleting(null)} />
      {editing && (
        <DefinitionEditor
          kind={editing.kind}
          id={editing.id}
          close={() => setEditing(null)}
          creating={editing.creating}
          existingIds={profiles.map((entry) => entry.id)}
        />
      )}
    </Stack>
  );
}

/**
 * A guide's profile count, which reveals their names in a popover: on hover where there is a
 * pointer that hovers, and on tap or click everywhere.
 */
function UsedBy({ guide, profiles = [] }: { guide: string; profiles?: string[] }) {
  const [opened, setOpened] = useState(false);
  const touch = useTouch();
  if (!profiles.length)
    return (
      <Text size="sm" c="dimmed">
        No Profiles
      </Text>
    );
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md">
      <Popover.Target>
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          rightSection={<ChevronDown size={12} />}
          aria-expanded={opened}
          // A hover has opened it already, so a click there keeps it open; a tap toggles it.
          onClick={() => setOpened(touch ? !opened : true)}
          // Focus stays on the count, so Escape closes the popover from here; the Library beneath
          // stays open, as a layer was above it when the key went down.
          onKeyDown={(event) => event.key === "Escape" && setOpened(false)}
          {...(!touch && {
            onMouseEnter: () => setOpened(true),
            onMouseLeave: () => setOpened(false),
          })}
        >
          {plural(profiles.length, "Profile")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown aria-label={`Profiles Using ${guide}`} aria-labelledby="" p="sm" maw={320}>
        <Stack gap={4}>
          {[...profiles].sort().map((name) => (
            <Text key={name} size="sm">
              {name}
            </Text>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Library › Guides: the prompting guides profiles use, under the section's toolbar; each keeps its saved versions. */
export function GuideDefinitions({ heading }: { heading: ReactNode }) {
  const [guideQuery, setGuideQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const { guideList, guides, users } = useDefinitions();
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Guides"
          query={guideQuery}
          onQueryChange={setGuideQuery}
          actions={
            <ToolbarAction
              label="New Guide"
              icon={icons.add}
              onClick={() =>
                setEditing({
                  kind: "guide",
                  id: "",
                  creating: { pack: { name: "", summary: "", rules: [] }, hash: "" },
                })
              }
            />
          }
        />
      </SectionHeader>
      {guideList.error ? (
        <Alert color="red">{guideList.error.message}</Alert>
      ) : (
        <DataTable
          label="Editable Guides"
          rows={guides}
          rowKey={(entry) => entry.packId}
          rowName={(entry) => entry.name}
          loading={guideList.isPending && "Loading Guides"}
          query={guideQuery}
          searchText={(entry) => [entry.name, entry.packId]}
          initialSort={{ key: "name", descending: false }}
          empty="No Guides"
          columns={[
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: (entry) => entry.name,
              // Copy ID has the exact ID.
              cell: (entry) => (
                <Text size="sm" fw={500} style={{ overflowWrap: "anywhere" }}>
                  {entry.name}
                </Text>
              ),
            },
            {
              key: "profiles",
              header: "Used By",
              sortValue: (entry) => users.get(entry.packId)?.length || 0,
              cell: (entry) => <UsedBy guide={entry.name} profiles={users.get(entry.packId)} />,
            },
            {
              key: "version",
              header: "Version",
              sortValue: (entry) => entry.version,
              cell: (entry) => <Version {...entry} />,
            },
          ]}
          rowActions={(entry) =>
            rowMenu({
              kind: "guide",
              id: entry.packId,
              name: entry.name,
              edit: setEditing,
              remove: setDeleting,
            })
          }
        />
      )}
      {editing && (
        <DefinitionEditor
          kind={editing.kind}
          id={editing.id}
          close={() => setEditing(null)}
          creating={editing.creating}
          existingIds={guides.map((entry) => entry.packId)}
        />
      )}
      <DeleteDefinition deleting={deleting} close={() => setDeleting(null)} />
    </Stack>
  );
}
