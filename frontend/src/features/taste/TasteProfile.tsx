import {
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  Pill,
  Stack,
  Switch,
  TagsInput,
  Text,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { type KeepCount, type KeepRates, keepRateMinimum } from "../../../../shared/dream";
import { loraName } from "../../../../shared/profiles";
import {
  type TagKind,
  type TasteArea,
  type TasteAreaSetting,
  type TasteFields,
  type TasteMarkKind,
  type TasteMarks,
  type TastePreferenceChanges,
  type TastePreferences,
  maxTasteGuidance,
  maxTastePhrase,
  maxTastePrefer,
  shapeName,
  tagKind,
  tasteAreas,
  tasteAreasOf,
  tasteLimits,
  tasteMarkKinds,
} from "../../../../shared/taste";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { ChatNotes } from "../dream/ChatNotes";
import { keepRatesQuery } from "../dream/queries";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { isProfile, profileName } from "../generation/payload";
import { preferencesQuery, useSavePreferences } from "../settings/accountPreferences";
import { TasteReflection } from "./TasteReflection";

/** What Studio learnt and the person's own taste (backend/domain/taste.ts). */
export interface Taste {
  learnt: TasteFields;
  preferences: TastePreferences;
  loraScores: { name: string; strength?: number; score: number }[];
  updatedAt: string;
  signals: number;
  writer: boolean;
}
export const tasteQuery = queryOptions({
  queryKey: ["taste"],
  queryFn: () => api<Taste>("/api/taste"),
});

const areaLabels: Record<TasteArea, string> = {
  dream: "Dream",
  suggestions: "Suggestions",
  writing: "Prompt Writing",
  chats: "Chats",
};
/** What an area receives besides Learnt and My Preferences while it uses taste, and always. */
const areaExtras: Record<TasteArea, { taste?: string; note: string }> = {
  dream: {
    taste: "Liked Prompts",
    note: "Models, LoRAs and shapes follow your ratings and Favourites either way.",
  },
  suggestions: {
    taste: "Liked & Disliked Prompts",
    note: "Ideas in the composer and the viewer's menus.",
  },
  writing: {
    note: "Improve Prompt and Animate. Improve Prompt learns from your liked prompts either way.",
  },
  chats: { note: "Excluded words are removed from chat prompts, with a note." },
};
const receives = (area: TasteArea, { taste, guidance }: TasteAreaSetting) =>
  `Receives: ${[
    taste && "Learnt",
    taste && areaExtras[area].taste,
    taste && "My Preferences",
    guidance && "Guidance",
    "Exclusions",
  ]
    .filter(Boolean)
    .join(" · ")}. ${areaExtras[area].note}`;

const markLabels: Record<TasteMarkKind, string> = {
  words: "Word",
  models: "Model",
  loras: "LoRA",
  shapes: "Shape",
  tags: "Tag",
};
const tagGroups: [TagKind | undefined, string][] = [
  ["colour", "Colours"],
  ["outfit", "Outfits"],
  ["scene", "Scenes"],
  [undefined, "Tags"],
];
/** How many learnt values each table shows beyond those Studio learnt. */
const ratedShown = 10;
const keepRate = (count?: KeepCount) =>
  count && count.total >= keepRateMinimum ? count.kept / count.total : undefined;
const without = (marks: TasteMarks | undefined, kind: TasteMarkKind, value: string) => ({
  ...marks,
  [kind]: (marks?.[kind] ?? []).filter((entry) => entry !== value),
});

/** Saves the person's own taste; each key replaces its whole value. A dialog shows its own error. */
function useTasteChange(inlineError = false) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError },
    mutationFn: (preferences: TastePreferenceChanges) =>
      api<Taste>("/api/taste", { method: "PUT", body: JSON.stringify({ preferences }) }),
    onSuccess: (next) => {
      client.setQueryData(tasteQuery.queryKey, next);
      void client.invalidateQueries({ queryKey: ["suggestions"], refetchType: "none" });
    },
  });
}

/** Readable names for each kind of marked value; models no longer offered have none. */
function useValueNames() {
  const models = useQuery(modelsQuery);
  const loraInfo = useQuery(loraInfoQuery);
  return (kind: TasteMarkKind, value: string): string | undefined => {
    if (kind === "models") {
      const profile = models.data?.profiles.find((entry) => isProfile(entry, value));
      return profile && profileName(profile);
    }
    if (kind === "loras") return loraName(value, loraInfo.data?.loras[value]);
    if (kind === "shapes") return shapeName(value);
    return value;
  };
}

/** A free-text dialog with Save: an area's guidance or My Preferences. */
function TextDialog({
  id,
  title,
  label,
  description,
  initial,
  maxLength,
  onClose,
  save,
}: {
  id: string;
  title: string;
  label: string;
  description: string;
  initial: string | null;
  maxLength: number;
  onClose: () => void;
  save: (text: string) => Promise<unknown>;
}) {
  const phone = usePhone();
  return (
    <Modal
      id={id}
      opened={initial !== null}
      onClose={closeWhenTop(id, onClose)}
      title={title}
      size="lg"
      fullScreen={phone}
    >
      {initial !== null && (
        <TextForm
          label={label}
          description={description}
          initial={initial}
          maxLength={maxLength}
          onClose={onClose}
          save={save}
        />
      )}
    </Modal>
  );
}
function TextForm({
  label,
  description,
  initial,
  maxLength,
  onClose,
  save,
}: {
  label: string;
  description: string;
  initial: string;
  maxLength: number;
  onClose: () => void;
  save: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(initial);
  const saving = useMutation({
    meta: { inlineError: true },
    mutationFn: () => save(text.trim()),
    onSuccess: onClose,
  });
  return (
    <Stack>
      <TextBox
        label={label}
        description={description}
        value={text}
        onChange={setText}
        autosize
        minRows={3}
        maxLength={maxLength}
      />
      {saving.error && <Alert color="red">{saving.error.message}</Alert>}
      <DialogFooter pending={saving.isPending} onCancel={onClose}>
        <Button
          loading={saving.isPending}
          disabled={text.trim() === initial.trim()}
          onClick={() => saving.mutate()}
        >
          Save
        </Button>
      </DialogFooter>
    </Stack>
  );
}

/** Where Taste Applies: each area's switch, guidance and what it receives. */
function WhereTasteApplies() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  const saveGuidance = useSavePreferences(undefined, true);
  const [editing, setEditing] = useState<TasteArea | null>(null);
  const areas = tasteAreasOf(status?.preferences.tasteAreas);
  const changed = (area: TasteArea, setting: Partial<TasteAreaSetting>) => ({
    tasteAreas: { ...areas, [area]: { ...areas[area], ...setting } },
  });
  return (
    <SettingGroup title="Where Taste Applies">
      {tasteAreas.map((area) => (
        <SettingRow key={area} label={areaLabels[area]} description={receives(area, areas[area])}>
          <Button
            size="compact-sm"
            variant="default"
            disabled={!status}
            aria-label={`Edit ${areaLabels[area]} Guidance`}
            onClick={() => setEditing(area)}
          >
            Edit
          </Button>
          <Switch
            aria-label={`Use My Taste in ${areaLabels[area]}`}
            checked={areas[area].taste}
            disabled={!status}
            onChange={(event) => save.mutate(changed(area, { taste: event.currentTarget.checked }))}
          />
        </SettingRow>
      ))}
      <TextDialog
        id="taste-guidance"
        title={editing ? `${areaLabels[editing]} Guidance` : ""}
        label="Guidance"
        description="Sent with this area's work whether or not it uses your taste, after your Exclusions."
        initial={editing && areas[editing].guidance}
        maxLength={maxTasteGuidance}
        onClose={() => setEditing(null)}
        save={(guidance) => saveGuidance.mutateAsync(changed(editing!, { guidance }))}
      />
    </SettingGroup>
  );
}

/** A removable value of the person's own: a Favourite, an Exclusion. */
function OwnPills({
  values,
  name,
  remove,
  pending,
}: {
  values: { key: string; label: string }[];
  name?: string;
  remove: (key: string) => void;
  pending: boolean;
}) {
  if (!values.length)
    return (
      <Text span size="sm" c="text">
        None
      </Text>
    );
  return (
    <Group component="span" gap={4} mt={4}>
      {values.map(({ key, label }) => (
        <Pill
          key={key}
          withRemoveButton
          onRemove={() => remove(key)}
          // Pills inside an input hide their remove button from keyboards; these stand alone, so
          // it is the only way to remove a value.
          removeButtonProps={{
            "aria-hidden": false,
            tabIndex: 0,
            "aria-label": `Remove ${label}${name ? ` from ${name}` : ""}`,
            disabled: pending,
          }}
        >
          {label}
        </Pill>
      ))}
    </Group>
  );
}

/** A learnt value's actions: More Like This, Less Like This and, for words and tags, Never. */
function MarkItems({
  kind,
  value,
  taste,
  mark,
  pending,
}: {
  kind: TasteMarkKind;
  value: string;
  taste: Taste;
  mark: (kind: TasteMarkKind, value: string, to: "favourites" | "less" | "never") => void;
  pending: boolean;
}) {
  const full = (marks?: TasteMarks) => (marks?.[kind]?.length ?? 0) >= tasteLimits[kind];
  return (
    <>
      <Menu.Item
        leftSection={<icons.pin size={16} />}
        disabled={pending || full(taste.preferences.favourites)}
        onClick={() => mark(kind, value, "favourites")}
      >
        More Like This
      </Menu.Item>
      <Menu.Item
        leftSection={<icons.less size={16} />}
        disabled={pending || full(taste.preferences.less)}
        onClick={() => mark(kind, value, "less")}
      >
        Less Like This
      </Menu.Item>
      {(kind === "words" || kind === "tags") && (
        <Menu.Item
          leftSection={<icons.exclude size={16} />}
          disabled={
            pending || (taste.preferences.exclusions?.length ?? 0) >= tasteLimits.exclusions
          }
          onClick={() => mark(kind, value, "never")}
        >
          Never
        </Menu.Item>
      )}
    </>
  );
}

/** A learnt word, its actions behind it. */
function LearntWords({
  label,
  words,
  ...marks
}: {
  label: string;
  words: string[];
} & Omit<Parameters<typeof MarkItems>[0], "kind" | "value">) {
  return (
    <SettingRow
      label={label}
      description={
        words.length ? (
          <Group component="span" gap={4} mt={4}>
            {words.map((word) => (
              <Menu key={word} position="bottom-start">
                <Menu.Target>
                  <Button
                    size="compact-xs"
                    variant="default"
                    rightSection={<ChevronDown size={12} />}
                  >
                    {word}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <MarkItems {...marks} kind="words" value={word} />
                </Menu.Dropdown>
              </Menu>
            ))}
          </Group>
        ) : (
          <Text span size="sm" c="text">
            None
          </Text>
        )
      }
    />
  );
}

interface RatedRow {
  value: string;
  name: string;
  count?: KeepCount;
}
/** One kind of learnt values with their keep rates, each with its actions. */
function KeepRateTable({
  title,
  kind,
  learnt,
  counts,
  name,
  include = () => true,
  marked,
  ...marks
}: {
  title: string;
  kind: "models" | "loras" | "tags";
  learnt: string[];
  counts: Record<string, KeepCount>;
  name: (value: string) => string | undefined;
  include?: (value: string) => boolean;
  marked: (value: string) => boolean;
} & Omit<Parameters<typeof MarkItems>[0], "kind" | "value">) {
  let others = 0;
  const rows = [
    ...new Set([
      ...learnt.filter(include),
      ...Object.keys(counts).filter(
        (value) => include(value) && !marked(value) && keepRate(counts[value]) !== undefined,
      ),
    ]),
  ]
    .flatMap((value): RatedRow[] => {
      const shown = name(value);
      return shown ? [{ value, name: shown, count: counts[value] }] : [];
    })
    .sort(
      (a, b) =>
        (keepRate(b.count) ?? -1) - (keepRate(a.count) ?? -1) || compareNames(a.name, b.name),
    )
    .filter((row) => learnt.includes(row.value) || others++ < ratedShown);
  if (!rows.length) return null;
  return (
    <SettingGroup title={title}>
      <DataTable
        label={title}
        rows={rows}
        rowKey={(row) => row.value}
        rowName={(row) => row.name}
        empty="None"
        compact
        columns={[
          {
            key: "name",
            header: "Name",
            main: true,
            cell: (row) => (
              <Text size="sm" truncate>
                {row.name}
              </Text>
            ),
          },
          {
            key: "kept",
            header: "Kept",
            sortValue: (row) => keepRate(row.count),
            cell: (row) => {
              const rate = keepRate(row.count);
              return (
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {rate === undefined
                    ? "Too few verdicts"
                    : `${Math.round(rate * 100)}% of ${row.count!.total}`}
                </Text>
              );
            },
          },
        ]}
        rowActions={(row) => <MarkItems {...marks} kind={kind} value={row.value} />}
      />
    </SettingGroup>
  );
}

/**
 * Settings › Taste: where taste applies, the person's own preferences and exclusions, and what
 * Studio learnt from their ratings, which they steer with More Like This, Less Like This and Never.
 */
export function TasteProfile({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const keepRates = useQuery(keepRatesQuery);
  const nameOf = useValueNames();
  const change = useTasteChange();
  const dialogChange = useTasteChange(true);
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editingPrefer, setEditingPrefer] = useState(false);
  const [editingExclusions, setEditingExclusions] = useState(false);
  const saved = (next: Taste) => {
    client.setQueryData(tasteQuery.queryKey, next);
    void client.invalidateQueries({ queryKey: ["suggestions"], refetchType: "none" });
  };
  const refresh = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<Taste>("/api/taste/refresh"),
    onSuccess: saved,
  });
  const clear = useMutation({
    meta: { inlineError: true },
    mutationFn: () => api<Taste>("/api/taste", { method: "DELETE" }),
    onSuccess: (next) => {
      saved(next);
      setClearing(false);
    },
  });
  // The words are forgotten even when the rebuild fails, so the profile reloads either way.
  const reset = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<Taste>("/api/taste/reset"),
    onSuccess: (next) => {
      saved(next);
      setResetting(false);
    },
    onError: () => client.invalidateQueries({ queryKey: tasteQuery.queryKey }),
  });
  const data = taste.data;
  const rates = keepRates.data;
  const error = refresh.error || taste.error || keepRates.error;
  const own = data?.preferences ?? {};
  const exclusions = own.exclusions ?? [];
  const mark = (kind: TasteMarkKind, value: string, to: "favourites" | "less" | "never") => {
    const add = (marks?: TasteMarks) => ({ ...marks, [kind]: [...(marks?.[kind] ?? []), value] });
    change.mutate({
      favourites: to === "favourites" ? add(own.favourites) : without(own.favourites, kind, value),
      less: to === "less" ? add(own.less) : without(own.less, kind, value),
      ...(to === "never" && { exclusions: [...exclusions, value] }),
    });
  };
  const marked = (kind: TasteMarkKind) => (value: string) =>
    [...(own.favourites?.[kind] ?? []), ...(own.less?.[kind] ?? [])].includes(value) ||
    exclusions.includes(value);
  const pills = (marks: TasteMarks | undefined) =>
    tasteMarkKinds.flatMap((kind) =>
      (marks?.[kind] ?? []).map((value) => ({
        key: `${kind}\n${value}`,
        kind,
        value,
        label: `${markLabels[kind]}: ${nameOf(kind, value) ?? value}`,
      })),
    );
  const favourites = pills(own.favourites);
  const less = pills(own.less);
  const shared = data && { taste: data, mark, pending: change.isPending };
  const loraLabel = (name: string) => {
    const strength = data?.loraScores.find((lora) => lora.name === name)?.strength;
    return `${nameOf("loras", name)}${strength === undefined ? "" : ` ${strength}`}`;
  };
  const ratedTables = (data: Taste, rates: KeepRates) => (
    <>
      <KeepRateTable
        {...shared!}
        title="Models"
        kind="models"
        learnt={data.learnt.models.slice(0, 3)}
        counts={rates.profiles}
        name={(id) => nameOf("models", id)}
        marked={marked("models")}
      />
      <KeepRateTable
        {...shared!}
        title="LoRAs"
        kind="loras"
        learnt={data.learnt.loras.slice(0, 3)}
        counts={rates.loras}
        name={loraLabel}
        marked={marked("loras")}
      />
      {tagGroups.map(([kind, title]) => (
        <KeepRateTable
          {...shared!}
          key={title}
          title={title}
          kind="tags"
          learnt={data.learnt.tags.slice(0, 5)}
          counts={rates.tags}
          name={(tag) => tag}
          include={(tag) => tagKind(tag) === kind}
          marked={marked("tags")}
        />
      ))}
    </>
  );
  const learntLine =
    data &&
    [
      data.signals &&
        `Learnt from ${data.signals} ${data.signals === 1 ? "like, comparison or iteration" : "likes, comparisons and iterations"}`,
      data.updatedAt && `Updated ${formatDateTime(data.updatedAt)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <Stack gap="lg">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Taste"
          actions={
            data?.writer && (
              <ToolbarAction
                label="Refresh"
                icon={icons.refresh}
                iconOnly
                disabled={refresh.isPending || !data.signals}
                onClick={() => refresh.mutate()}
              />
            )
          }
        />
      </SectionHeader>
      {error && <Alert color="red">{error.message}</Alert>}
      <WhereTasteApplies />
      {taste.isPending && <LoadingState label="Loading Taste" />}
      {data && (
        <>
          <SettingGroup title="My Preferences">
            <SettingRow
              label="Preferences"
              description={
                <Text span size="sm" c="text" style={{ whiteSpace: "pre-wrap" }}>
                  {own.prefer || "None"}
                </Text>
              }
            >
              <Button size="compact-sm" variant="default" onClick={() => setEditingPrefer(true)}>
                Edit
              </Button>
            </SettingRow>
            <SettingRow
              label="Favourites"
              description={
                <OwnPills
                  values={favourites}
                  name="Favourites"
                  pending={change.isPending}
                  remove={(key) => {
                    const { kind, value } = favourites.find((entry) => entry.key === key)!;
                    change.mutate({ favourites: without(own.favourites, kind, value) });
                  }}
                />
              }
            />
            <SettingRow
              label="Less Of"
              description={
                <OwnPills
                  values={less}
                  name="Less Of"
                  pending={change.isPending}
                  remove={(key) => {
                    const { kind, value } = less.find((entry) => entry.key === key)!;
                    change.mutate({ less: without(own.less, kind, value) });
                  }}
                />
              }
            />
          </SettingGroup>
          <SettingGroup title="Exclusions">
            <SettingRow
              label="Exclusions"
              description={
                <>
                  Never used anywhere: Dream, suggestions, prompt writing and chats.
                  <OwnPills
                    values={exclusions.map((value) => ({ key: value, label: value }))}
                    name="Exclusions"
                    pending={change.isPending}
                    remove={(value) =>
                      change.mutate({
                        exclusions: exclusions.filter((entry) => entry !== value),
                      })
                    }
                  />
                </>
              }
            >
              <Button
                size="compact-sm"
                variant="default"
                onClick={() => setEditingExclusions(true)}
              >
                Edit
              </Button>
            </SettingRow>
          </SettingGroup>
          <SettingGroup title="Learnt From Your Ratings">
            <Text size="xs" c="dimmed">
              {learntLine ||
                "Nothing learnt yet. Like, compare or iterate on results and Studio picks up your taste."}
            </Text>
            <SettingRow
              label="Note"
              description={
                <Text span size="sm" c="text" style={{ overflowWrap: "anywhere" }}>
                  {data.learnt.note || "None"}
                </Text>
              }
            />
            <LearntWords {...shared!} label="Likes" words={data.learnt.likes} />
            <LearntWords {...shared!} label="Styles" words={data.learnt.styles} />
            <LearntWords {...shared!} label="Leans Away From" words={data.learnt.avoid} />
            <SettingRow
              label="Shapes"
              description={
                data.learnt.shapes.length ? (
                  <Group component="span" gap={4} mt={4}>
                    {data.learnt.shapes.slice(0, 3).map((shape) => (
                      <Menu key={shape} position="bottom-start">
                        <Menu.Target>
                          <Button
                            size="compact-xs"
                            variant="default"
                            rightSection={<ChevronDown size={12} />}
                          >
                            {shapeName(shape)}
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <MarkItems {...shared!} kind="shapes" value={shape} />
                        </Menu.Dropdown>
                      </Menu>
                    ))}
                  </Group>
                ) : (
                  <Text span size="sm" c="text">
                    None
                  </Text>
                )
              }
            />
          </SettingGroup>
          {rates && ratedTables(data, rates)}
        </>
      )}
      <TasteReflection />
      <ChatNotes />
      <SettingGroup title="Danger Zone" danger>
        <SettingRow
          label="Reset Learnt Taste"
          description="Forget the learnt note, likes, styles and leanings and learn them again from your ratings. Your preferences, favourites and exclusions stay."
        >
          <Button
            size="compact-sm"
            color="red"
            variant="light"
            disabled={!data}
            onClick={() => setResetting(true)}
          >
            Reset
          </Button>
        </SettingRow>
        <SettingRow
          label="Clear Taste Profile"
          description="Forget what Studio learnt and your own preferences and exclusions."
        >
          <Button
            size="compact-sm"
            color="red"
            variant="light"
            disabled={!data || (!data.signals && !Object.keys(data.preferences).length)}
            onClick={() => setClearing(true)}
          >
            Clear
          </Button>
        </SettingRow>
      </SettingGroup>
      <TextDialog
        id="taste-preferences"
        title="My Preferences"
        label="Preferences"
        description="What you want, in your own words, for every area that uses your taste. Studio never learns over it."
        initial={editingPrefer ? (own.prefer ?? "") : null}
        maxLength={maxTastePrefer}
        onClose={() => setEditingPrefer(false)}
        save={(prefer) => dialogChange.mutateAsync({ prefer: prefer || null })}
      />
      <ExclusionsDialog
        opened={editingExclusions}
        exclusions={exclusions}
        onClose={() => setEditingExclusions(false)}
        save={(next) => dialogChange.mutateAsync({ exclusions: next })}
      />
      <ConfirmDialog
        opened={clearing}
        title="Clear Taste Profile"
        action="Clear"
        pending={clear.isPending}
        error={clear.error?.message}
        onConfirm={() => clear.mutate()}
        onClose={() => {
          setClearing(false);
          clear.reset();
        }}
      >
        Studio forgets what it learnt, your preferences, favourites and exclusions. Your gallery and
        likes stay.
      </ConfirmDialog>
      <ConfirmDialog
        opened={resetting}
        title="Reset Learnt Taste"
        action="Reset"
        pending={reset.isPending}
        error={reset.error?.message}
        onConfirm={() => reset.mutate()}
        onClose={() => {
          setResetting(false);
          reset.reset();
        }}
      >
        Studio forgets the note, likes, styles and leanings it learnt and learns them again from
        your likes, comparisons and other signals. Your preferences, favourites and exclusions stay.
      </ConfirmDialog>
    </Stack>
  );
}

/** Edits the Exclusions, which apply everywhere. */
function ExclusionsDialog({
  opened,
  exclusions,
  onClose,
  save,
}: {
  opened: boolean;
  exclusions: string[];
  onClose: () => void;
  save: (exclusions: string[]) => Promise<unknown>;
}) {
  const phone = usePhone();
  return (
    <Modal
      id="taste-exclusions"
      opened={opened}
      onClose={closeWhenTop("taste-exclusions", onClose)}
      title="Exclusions"
      size="lg"
      fullScreen={phone}
    >
      {opened && <ExclusionsForm initial={exclusions} onClose={onClose} save={save} />}
    </Modal>
  );
}
function ExclusionsForm({
  initial,
  onClose,
  save,
}: {
  initial: string[];
  onClose: () => void;
  save: (exclusions: string[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(initial);
  const saving = useMutation({
    meta: { inlineError: true },
    mutationFn: () => save(draft),
    onSuccess: onClose,
  });
  return (
    <Stack>
      <TagsInput
        label="Exclusions"
        description="Add a subject, prop or setting and press Enter. For example, smoking or laundry rooms."
        value={draft}
        onChange={setDraft}
        maxTags={tasteLimits.exclusions}
        maxLength={maxTastePhrase}
      />
      {saving.error && <Alert color="red">{saving.error.message}</Alert>}
      <DialogFooter pending={saving.isPending} onCancel={onClose}>
        <Button
          loading={saving.isPending}
          disabled={JSON.stringify(draft) === JSON.stringify(initial)}
          onClick={() => saving.mutate()}
        >
          Save
        </Button>
      </DialogFooter>
    </Stack>
  );
}
