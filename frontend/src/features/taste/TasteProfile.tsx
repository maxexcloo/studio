import {
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  Pill,
  SimpleGrid,
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
import { menuWidth } from "../../theme";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { HistoryTable, compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { PreviewList } from "../../ui/PreviewList";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { ChatChoices } from "../dream/ChatChoices";
import { ChatNotes } from "../dream/ChatNotes";
import { keepRatesQuery } from "../dream/queries";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { isProfile, profileName } from "../generation/payload";
import { ProfileSelect } from "../generation/ProfilePicker";
import { preferencesQuery, useSavePreferences } from "../settings/accountPreferences";
import { TasteVariety } from "./TasteReflection";

import classes from "./TasteProfile.module.css";

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
/** What each area's switch changes, in plain words; Exclusions apply whatever it says. */
const areaEffects: Record<TasteArea, string> = {
  dream:
    "Dream's ideas follow your taste and liked prompts. Models, LoRAs and shapes follow your ratings either way.",
  suggestions: "Ideas in the composer and the viewer follow your taste and the prompts you rated.",
  writing:
    "Improve Prompt and Animate follow your taste. Improve Prompt learns from your liked prompts either way.",
  chats: "Prompts written in chats follow your taste.",
};

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

function TasteEditDialog({
  id,
  title,
  opened,
  onClose,
  children,
}: {
  id: string;
  title: string;
  opened: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  return (
    <Modal
      id={id}
      opened={opened}
      onClose={closeWhenTop(id, onClose)}
      title={title}
      size="lg"
      fullScreen={phone}
      classNames={{ content: classes.editDialog }}
    >
      {opened && children}
    </Modal>
  );
}

/** A free-text dialog with Save for guidance and preferences. */
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
  return (
    <TasteEditDialog id={id} title={title} opened={initial !== null} onClose={onClose}>
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
    </TasteEditDialog>
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
        aria-label={label}
        description={description}
        value={text}
        onChange={setText}
        autosize
        minRows={3}
        classNames={{ input: classes.editField }}
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

/** Each area's taste switch and guidance. */
function TasteEnabled() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  const saveGuidance = useSavePreferences(undefined, true);
  const [editing, setEditing] = useState<TasteArea | null>(null);
  const areas = tasteAreasOf(status?.preferences.tasteAreas);
  const changed = (area: TasteArea, setting: Partial<TasteAreaSetting>) => ({
    tasteAreas: { ...areas, [area]: { ...areas[area], ...setting } },
  });
  return (
    <SettingGroup title="Enabled">
      {[...tasteAreas]
        .sort((a, b) => compareNames(areaLabels[a], areaLabels[b]))
        .map((area) => (
          <SettingRow key={area} label={areaLabels[area]} description={areaEffects[area]}>
            <Button
              size="compact-sm"
              variant="default"
              disabled={!status}
              aria-label={`Edit ${areaLabels[area]} Guidance`}
              onClick={() => setEditing(area)}
            >
              Edit Guidance
            </Button>
            <Switch
              aria-label={`Use My Taste in ${areaLabels[area]}`}
              checked={areas[area].taste}
              disabled={!status}
              onChange={(event) =>
                save.mutate(changed(area, { taste: event.currentTarget.checked }))
              }
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

/** A removable value of the person's own (a Favourite, an Exclusion), under a line saying how they get there. */
function OwnPills({
  hint,
  values,
  name,
  remove,
  pending,
}: {
  hint: string;
  values: { key: string; label: string }[];
  name: string;
  remove: (key: string) => void;
  pending: boolean;
}) {
  return (
    <>
      <Text span inherit display="block">
        {hint}
      </Text>
      {values.length ? (
        <PreviewList items={[...values].sort((a, b) => compareNames(a.label, b.label))} inline>
          {(shown) => (
            <Group component="span" gap={4} mt={4}>
              {shown.map(({ key, label }) => (
                <Pill
                  key={key}
                  withRemoveButton
                  onRemove={() => remove(key)}
                  // Pills inside an input hide their remove button from keyboards; these stand alone, so
                  // it is the only way to remove a value.
                  removeButtonProps={{
                    "aria-hidden": false,
                    tabIndex: 0,
                    "aria-label": `Remove ${label} from ${name}`,
                    disabled: pending,
                  }}
                >
                  {label}
                </Pill>
              ))}
            </Group>
          )}
        </PreviewList>
      ) : (
        <Text span size="sm" c="text" display="block">
          None
        </Text>
      )}
    </>
  );
}

/** A learnt value's actions: Add to Favourites, Add to Less Of and, for words and tags, Add to Exclusions. */
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
        Add to Favourites
      </Menu.Item>
      <Menu.Item
        leftSection={<icons.less size={16} />}
        disabled={pending || full(taste.preferences.less)}
        onClick={() => mark(kind, value, "less")}
      >
        Add to Less Of
      </Menu.Item>
      {(kind === "words" || kind === "tags") && (
        <Menu.Item
          leftSection={<icons.exclude size={16} />}
          disabled={
            pending || (taste.preferences.exclusions?.length ?? 0) >= tasteLimits.exclusions
          }
          onClick={() => mark(kind, value, "never")}
        >
          Add to Exclusions
        </Menu.Item>
      )}
    </>
  );
}

/** Learnt words or shapes as chips, each value's actions behind it. */
function LearntValues({
  label,
  values,
  kind = "words",
  name = (value) => value,
  ...marks
}: {
  label: string;
  values: string[];
  kind?: "words" | "shapes";
  name?: (value: string) => string;
} & Omit<Parameters<typeof MarkItems>[0], "kind" | "value">) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed">
        {label}
      </Text>
      <PreviewList items={[...values].sort((a, b) => compareNames(name(a), name(b)))}>
        {(shown) => (
          <Group gap={4}>
            {shown.map((value) => (
              <Menu key={value} position="bottom-start" width={menuWidth}>
                <Menu.Target>
                  <Button
                    size="compact-xs"
                    variant="default"
                    rightSection={<ChevronDown size={12} />}
                  >
                    {name(value)}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <MarkItems {...marks} kind={kind} value={value} />
                </Menu.Dropdown>
              </Menu>
            ))}
          </Group>
        )}
      </PreviewList>
    </Stack>
  );
}

interface RatedRow {
  value: string;
  name: string;
  count?: KeepCount;
  preference?: string;
}
/** One kind of learnt values with their keep rates, each with its actions. */
function KeepRateTable({
  title,
  kind,
  rows,
  ...marks
}: {
  title: string;
  kind: "models" | "loras" | "tags";
  rows: RatedRow[];
} & Omit<Parameters<typeof MarkItems>[0], "kind" | "value">) {
  return (
    <SettingGroup title={title}>
      <HistoryTable
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
            sortValue: (row) => row.name,
            cell: (row) => (
              <Stack gap={0}>
                <Text size="sm" truncate>
                  {row.name}
                </Text>
                {row.preference && (
                  <Text size="xs" c="dimmed">
                    {row.preference}
                  </Text>
                )}
              </Stack>
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
 * Studio learnt from their ratings, which they steer by adding values to Favourites, Less Of and
 * Exclusions.
 */
export function TasteProfile({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const keepRates = useQuery(keepRatesQuery);
  const nameOf = useValueNames();
  const models = useQuery(modelsQuery).data?.profiles ?? [];
  const change = useTasteChange();
  const dialogChange = useTasteChange(true);
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editingPrefer, setEditingPrefer] = useState(false);
  const [editingExclusions, setEditingExclusions] = useState(false);
  const [editingModels, setEditingModels] = useState<"favourites" | "less">();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const editModels = (kind: "favourites" | "less") => {
    dialogChange.reset();
    setSelectedModel(null);
    setEditingModels(kind);
  };
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
  const markChange = (kind: TasteMarkKind, value: string, to: "favourites" | "less" | "never") => {
    const add = (marks?: TasteMarks) => ({ ...marks, [kind]: [...(marks?.[kind] ?? []), value] });
    return {
      favourites: to === "favourites" ? add(own.favourites) : without(own.favourites, kind, value),
      less: to === "less" ? add(own.less) : without(own.less, kind, value),
      ...(to === "never" && { exclusions: [...exclusions, value] }),
    };
  };
  const mark = (...args: Parameters<typeof markChange>) => change.mutate(markChange(...args));
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
  const ratingGroups = (data: Taste, rates: KeepRates) => {
    const categories: {
      title: string;
      kind: "models" | "loras" | "tags";
      counts: Record<string, KeepCount>;
      name: (value: string) => string | undefined;
      include?: (value: string) => boolean;
    }[] = [
      { title: "LoRAs", kind: "loras", counts: rates.loras, name: loraLabel },
      {
        title: "Models",
        kind: "models",
        counts: rates.profiles,
        name: (id: string) => nameOf("models", id),
      },
      ...tagGroups.map(([kind, title]) => ({
        title,
        kind: "tags" as const,
        counts: rates.tags,
        name: (tag: string) => tag,
        include: (tag: string) => tagKind(tag) === kind,
      })),
    ];
    return categories
      .sort((a, b) => compareNames(a.title, b.title))
      .flatMap(({ title, kind, counts, name, include = () => true }) => {
        const alreadyMarked = marked(kind);
        const values = new Set([
          ...data.learnt[kind].filter(include),
          ...Object.keys(counts).filter(
            (value) =>
              include(value) &&
              (kind === "models" || !alreadyMarked(value)) &&
              keepRate(counts[value]) !== undefined,
          ),
        ]);
        const rows = [...values]
          .flatMap((value): RatedRow[] => {
            const shown = name(value);
            const preference =
              kind === "models"
                ? own.favourites?.models?.includes(value)
                  ? "Favourite"
                  : own.less?.models?.includes(value)
                    ? "Less Of"
                    : undefined
                : undefined;
            return shown ? [{ value, name: shown, count: counts[value], preference }] : [];
          })
          .sort((a, b) => compareNames(a.name, b.name));
        return rows.length ? [{ title, kind, rows }] : [];
      });
  };
  const ratings = data && rates ? ratingGroups(data, rates) : [];
  const learntPatterns = data
    ? [
        { label: "Leans Away From", values: data.learnt.avoid },
        { label: "Likes", values: data.learnt.likes },
        { label: "Shapes", values: data.learnt.shapes, kind: "shapes" as const, name: shapeName },
        { label: "Styles", values: data.learnt.styles },
      ].filter(({ values }) => values.length)
    : [];
  const hasLearntTaste = data && (data.learnt.note || learntPatterns.length || ratings.length);
  const phone = usePhone();
  const learntLine =
    data &&
    [
      data.signals && `${data.signals} Recent ${data.signals === 1 ? "Signal" : "Signals"}`,
      data.updatedAt && `Summary updated ${formatDateTime(data.updatedAt)}`,
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
      <Text size="sm" c="dimmed">
        Studio learns your taste from ratings, comparisons and iterations. Set where it applies and
        add preferences to steer it yourself.
      </Text>
      <TasteEnabled />
      {taste.isPending && <LoadingState label="Loading Taste" />}
      {data && (
        <>
          <SettingGroup title="Preferences">
            <SettingRow
              label="Exclusions"
              description={
                <OwnPills
                  hint="Leave these out everywhere, even where taste is off."
                  values={exclusions.map((value) => ({ key: value, label: value }))}
                  name="Exclusions"
                  pending={change.isPending}
                  remove={(value) =>
                    change.mutate({
                      exclusions: exclusions.filter((entry) => entry !== value),
                    })
                  }
                />
              }
            >
              <Button
                size="compact-sm"
                variant="default"
                aria-label="Edit Exclusions"
                onClick={() => setEditingExclusions(true)}
              >
                Edit
              </Button>
            </SettingRow>
            <SettingRow
              label="In My Words"
              description={
                own.prefer ? (
                  <Text span size="sm" c="text" style={{ whiteSpace: "pre-wrap" }}>
                    {own.prefer}
                  </Text>
                ) : (
                  "Tell Studio what you want wherever taste is enabled."
                )
              }
            >
              <Button
                size="compact-sm"
                variant="default"
                aria-label="Edit In My Words"
                onClick={() => setEditingPrefer(true)}
              >
                Edit
              </Button>
            </SettingRow>
            <SettingRow
              label="Favourites"
              description={
                <OwnPills
                  hint="Add a model here or choose an item from the ratings below."
                  values={favourites}
                  name="Favourites"
                  pending={change.isPending}
                  remove={(key) => {
                    const { kind, value } = favourites.find((entry) => entry.key === key)!;
                    change.mutate({ favourites: without(own.favourites, kind, value) });
                  }}
                />
              }
            >
              <Button
                size="compact-sm"
                variant="default"
                aria-label="Edit Favourites"
                onClick={() => editModels("favourites")}
              >
                Edit
              </Button>
            </SettingRow>
            <SettingRow
              label="Less Of"
              description={
                <OwnPills
                  hint="Add a model here or choose an item from the ratings below."
                  values={less}
                  name="Less Of"
                  pending={change.isPending}
                  remove={(key) => {
                    const { kind, value } = less.find((entry) => entry.key === key)!;
                    change.mutate({ less: without(own.less, kind, value) });
                  }}
                />
              }
            >
              <Button
                size="compact-sm"
                variant="default"
                aria-label="Edit Less Of"
                onClick={() => editModels("less")}
              >
                Edit
              </Button>
            </SettingRow>
          </SettingGroup>
        </>
      )}
      {data && (
        <SettingGroup title="Learnt From Your Ratings">
          {hasLearntTaste ? (
            <Stack gap="md">
              {Boolean(learntPatterns.length || ratings.length) && (
                <Text size="sm" c="dimmed">
                  Open an item's menu to add it to Favourites, Less Of or Exclusions where
                  available.
                </Text>
              )}
              {data.learnt.note && (
                <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                  {data.learnt.note}
                </Text>
              )}
              {learntPatterns.length > 0 && (
                <SimpleGrid cols={phone ? 1 : 2} spacing="sm">
                  {learntPatterns.map((pattern) => (
                    <LearntValues {...shared!} {...pattern} key={pattern.label} />
                  ))}
                </SimpleGrid>
              )}
              {ratings.length > 0 && (
                <SettingGroup title="Recent Dream Image Verdicts">
                  <Stack gap="sm">
                    <Text size="xs" c="dimmed">
                      How often you kept results with each model, LoRA or tag.
                    </Text>
                    {ratings.map((category) => (
                      <KeepRateTable {...shared!} {...category} key={category.title} />
                    ))}
                  </Stack>
                </SettingGroup>
              )}
              {learntLine && (
                <Text size="xs" c="dimmed">
                  {learntLine}
                </Text>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Nothing learnt yet. Like, compare or iterate on results to teach Studio your taste.
            </Text>
          )}
        </SettingGroup>
      )}
      <ChatChoices />
      <ChatNotes />
      <TasteVariety />
      <SettingGroup danger>
        <SettingRow
          label="Reset Learnt Taste"
          description="Rebuild what Studio learnt from your ratings and keep your preferences."
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
          description="Clear what Studio learnt and all your Taste preferences."
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
        title="Edit Preferences"
        label="In My Words"
        description="What you want, in your own words, for every area that uses your taste. Studio never learns over it."
        initial={editingPrefer ? (own.prefer ?? "") : null}
        maxLength={maxTastePrefer}
        onClose={() => setEditingPrefer(false)}
        save={(prefer) => dialogChange.mutateAsync({ prefer: prefer || null })}
      />
      <TasteEditDialog
        id="taste-exclusions"
        opened={editingExclusions}
        title="Exclusions"
        onClose={() => setEditingExclusions(false)}
      >
        <ExclusionsForm
          initial={exclusions}
          onClose={() => setEditingExclusions(false)}
          save={(next) => dialogChange.mutateAsync({ exclusions: next })}
        />
      </TasteEditDialog>
      <TasteEditDialog
        id="taste-model-preference"
        title={editingModels === "less" ? "Edit Less Of" : "Edit Favourites"}
        opened={Boolean(editingModels)}
        onClose={() => setEditingModels(undefined)}
      >
        <Stack>
          <ProfileSelect
            name="Model"
            profiles={models.filter(
              (model) => !(editingModels && own[editingModels]?.models?.includes(model.id)),
            )}
            value={selectedModel}
            onChange={(model) => setSelectedModel(model?.id ?? null)}
            field
          />
          {dialogChange.error && <Alert color="red">{dialogChange.error.message}</Alert>}
          <DialogFooter onCancel={() => setEditingModels(undefined)}>
            <Button
              disabled={!selectedModel || !editingModels || dialogChange.isPending}
              onClick={() => {
                if (selectedModel && editingModels)
                  dialogChange.mutate(markChange("models", selectedModel, editingModels), {
                    onSuccess: () => setEditingModels(undefined),
                  });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </Stack>
      </TasteEditDialog>
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
        aria-label="Exclusions"
        description="Add a subject, prop or setting and press Enter. For example, smoking or laundry rooms."
        classNames={{ input: classes.editField }}
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
