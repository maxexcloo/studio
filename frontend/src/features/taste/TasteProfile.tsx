import {
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Pill,
  Stack,
  TagsInput,
  Text,
} from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";

import { type KeepCount, type KeepRates, keepRateMinimum } from "../../../../shared/dream";
import { loraName } from "../../../../shared/profiles";
import {
  type TagKind,
  type TasteFields,
  type TastePreferenceChanges,
  type TastePreferences,
  commonShapes,
  maxTastePhrase,
  maxTasteRule,
  shapeName,
  tagKind,
  tasteLimits,
} from "../../../../shared/taste";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { ChatNotes } from "../dream/ChatNotes";
import { keepRatesQuery } from "../dream/queries";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { isProfile, profileName } from "../generation/payload";
import { TasteReflection } from "./TasteReflection";

/** Each field as it stands, what Studio learnt, and the fields the person set. */
export interface Taste extends TasteFields {
  summary: string;
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
const learnt = (taste: Taste) =>
  [
    taste.signals &&
      `Learnt from ${taste.signals} ${taste.signals === 1 ? "like, comparison or iteration" : "likes, comparisons and iterations"}`,
    taste.updatedAt && `Updated ${formatDateTime(taste.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
const fieldLabels: Record<keyof TasteFields, string> = {
  note: "Summary",
  likes: "Likes",
  avoid: "Dislikes",
  exclusions: "Exclusions",
  loras: "LoRAs",
  models: "Models",
  rules: "Rules",
  shapes: "Shapes",
  styles: "Styles",
  tags: "Tags",
};
const fieldKeys = Object.keys(fieldLabels) as (keyof TasteFields)[];
/** Studio learns neither rules nor exclusions. */
const own = (key: keyof TasteFields) => key === "rules" || key === "exclusions";
/** How many of the favourites Studio learnt the profile shows; the person's own show whole. */
const learntShown: Partial<Record<keyof TasteFields, number>> = {
  models: 3,
  loras: 3,
  shapes: 3,
  tags: 5,
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields as the profile shows them: models no longer offered drop out rather than read
 * "Unavailable", and learnt favourites keep to the best few.
 */
function useTasteFields() {
  const models = useQuery(modelsQuery);
  const profileOf = (id: string) => models.data?.profiles.find((entry) => isProfile(entry, id));
  const shown = (key: keyof TasteFields, value: TasteFields[keyof TasteFields], own: boolean) => {
    if (typeof value === "string") return value;
    const listed = key === "models" ? value.flatMap((id) => profileOf(id)?.id ?? []) : value;
    return own ? listed : listed.slice(0, learntShown[key]);
  };
  return {
    ready: Boolean(models.data),
    profiles: models.data?.profiles || [],
    profileOf,
    /** The field as it stands. */
    current: <Key extends keyof TasteFields>(taste: Taste, key: Key) =>
      shown(key, taste[key], Object.hasOwn(taste.preferences, key)) as TasteFields[Key],
    /** What Studio learnt for the field. */
    learnt: <Key extends keyof TasteFields>(taste: Taste, key: Key) =>
      shown(key, taste.learnt[key], false) as TasteFields[Key],
  };
}

function TasteEditor({
  data,
  onClose,
  saved,
}: {
  data: Taste;
  onClose: () => void;
  saved: (next: Taste) => void;
}) {
  const fields = useTasteFields();
  const loraInfo = useQuery(loraInfoQuery);
  const initial = Object.fromEntries(
    fieldKeys.map((key) => [key, fields.current(data, key)]),
  ) as unknown as TasteFields;
  const [draft, setDraft] = useState(initial);
  const [resets, setResets] = useState(new Set<keyof TasteFields>());
  const changes: TastePreferenceChanges = Object.fromEntries(
    fieldKeys
      .filter((key) => resets.has(key) || !same(draft[key], initial[key]))
      .map((key) => [key, same(draft[key], fields.learnt(data, key)) ? null : draft[key]]),
  );
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api<Taste>("/api/taste", {
        method: "PUT",
        body: JSON.stringify({ preferences: changes }),
      }),
    onSuccess: (next) => {
      saved(next);
      onClose();
    },
  });
  const set = (key: keyof TasteFields) => (value: string | string[]) =>
    setDraft({ ...draft, [key]: value });
  // Chosen favourites stay choices even when they are no longer listed.
  const choices = (values: { value: string; label: string }[], kept: string[]) => [
    ...values,
    ...kept
      .filter((value) => !values.some((entry) => entry.value === value))
      .map((value) => ({ value, label: value })),
  ];
  const input = (key: keyof TasteFields) => {
    const label = fieldLabels[key];
    if (key === "note")
      return (
        <TextBox
          label={label}
          value={draft.note}
          onChange={set("note")}
          autosize
          minRows={3}
          maxLength={tasteLimits.note}
        />
      );
    const select = { label, value: draft[key], onChange: set(key), maxValues: tasteLimits[key] };
    if (key === "models")
      return (
        <MultiSelect
          {...select}
          searchable
          nothingFoundMessage="No Matches"
          data={fields.profiles.map((profile) => ({
            value: profile.id,
            label: profileName(profile),
          }))}
        />
      );
    if (key === "loras")
      return (
        <MultiSelect
          {...select}
          searchable
          nothingFoundMessage="No Matches"
          data={choices(
            Object.entries(loraInfo.data?.loras || {}).map(([name, info]) => ({
              value: name,
              label: loraName(name, info),
            })),
            draft.loras,
          )}
        />
      );
    if (key === "shapes")
      return (
        <MultiSelect
          {...select}
          // A learnt shape stands in for the common one it reads as, such as 0.68 for 2:3.
          data={[
            ...new Map(
              [...commonShapes, ...data.learnt.shapes, ...draft.shapes].map((shape) => [
                shapeName(shape),
                shape,
              ]),
            ).values(),
          ]
            .sort((a, b) => Number(a) - Number(b))
            .map((shape) => ({ value: shape, label: shapeName(shape) }))}
        />
      );
    if (key === "rules")
      return (
        <TagsInput
          label={label}
          description='Limits for Dream prompts, such as "always photographic, never CGI".'
          value={draft.rules}
          onChange={set("rules")}
          maxTags={tasteLimits.rules}
          maxLength={maxTasteRule}
          splitChars={[]}
        />
      );
    return (
      <TagsInput
        label={label}
        description={
          key === "exclusions"
            ? "Add a subject, prop or setting and press Enter. For example, smoking or laundry rooms."
            : undefined
        }
        value={draft[key]}
        onChange={set(key)}
        maxTags={tasteLimits[key]}
        maxLength={maxTastePhrase}
      />
    );
  };
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        A field you change stays yours; Studio keeps learning the others. Use Learnt hands a field
        back.
      </Text>
      {fieldKeys.map((key) => (
        <Stack key={key} gap={4}>
          {input(key)}
          {!own(key) &&
            ((Object.hasOwn(data.preferences, key) && !resets.has(key)) ||
              !same(draft[key], fields.learnt(data, key))) && (
              <Button
                size="compact-sm"
                variant="subtle"
                w="fit-content"
                onClick={() => {
                  setDraft({ ...draft, [key]: fields.learnt(data, key) });
                  setResets(new Set([...resets, key]));
                }}
              >
                Use Learnt {fieldLabels[key]}
              </Button>
            )}
        </Stack>
      ))}
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={onClose}>
        <Button
          loading={save.isPending}
          disabled={!Object.keys(changes).length}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </DialogFooter>
    </Stack>
  );
}

/** The fields shown as removable words; models, LoRAs and tags show with their keep rates. */
const wordKeys = ["likes", "styles", "avoid", "exclusions", "rules", "shapes"] as const;
const tagGroups: [TagKind | undefined, string][] = [
  ["colour", "Colours"],
  ["outfit", "Outfits"],
  ["scene", "Scenes"],
  [undefined, "Tags"],
];
/** How many of the best kept values each table adds to the account's favourites. */
const ratedShown = 10;
const keepRate = (count?: KeepCount) =>
  count && count.total >= keepRateMinimum ? count.kept / count.total : undefined;
interface RatedRow {
  value: string;
  name: string;
  count?: KeepCount;
  favourite: boolean;
}

/** One favourites field's values and its best kept ones, with Pin and Remove. */
function KeepRateTable({
  title,
  field,
  favourites,
  counts,
  name,
  include = () => true,
  edited,
  change,
  pending,
}: {
  title: string;
  field: "models" | "loras" | "tags";
  favourites: string[];
  counts: Record<string, KeepCount>;
  name: (value: string) => string | undefined;
  include?: (value: string) => boolean;
  edited: boolean;
  change: (changes: TastePreferenceChanges) => void;
  pending: boolean;
}) {
  let others = 0;
  const rows = [
    ...new Set([
      ...favourites.filter(include),
      ...Object.keys(counts).filter(
        (value) => include(value) && keepRate(counts[value]) !== undefined,
      ),
    ]),
  ]
    .flatMap((value): RatedRow[] => {
      const shown = name(value);
      return shown
        ? [{ value, name: shown, count: counts[value], favourite: favourites.includes(value) }]
        : [];
    })
    .sort(
      (a, b) =>
        (keepRate(b.count) ?? -1) - (keepRate(a.count) ?? -1) || compareNames(a.name, b.name),
    )
    .filter((row) => row.favourite || others++ < ratedShown);
  if (!rows.length) return null;
  const full = favourites.length >= tasteLimits[field];
  return (
    <SettingGroup title={`${title}${edited ? " · Your Edit" : ""}`}>
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
              <Group gap="xs" wrap="nowrap">
                <Text size="sm" truncate>
                  {row.name}
                </Text>
                {row.favourite && (
                  <Badge size="xs" variant="light">
                    Favourite
                  </Badge>
                )}
              </Group>
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
        rowActions={(row) =>
          row.favourite ? (
            <Menu.Item
              leftSection={<icons.clear size={16} />}
              disabled={pending}
              onClick={() => change({ [field]: favourites.filter((value) => value !== row.value) })}
            >
              Remove
            </Menu.Item>
          ) : (
            <Menu.Item
              leftSection={<icons.pin size={16} />}
              disabled={full || pending}
              onClick={() => change({ [field]: [...favourites, row.value] })}
            >
              Pin
            </Menu.Item>
          )
        }
      />
    </SettingGroup>
  );
}

/** The taste profile: each field learnt from feedback until the person sets it. */
export function TasteProfile({ toolbar }: { toolbar: HTMLElement | null }) {
  const phone = usePhone();
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const keepRates = useQuery(keepRatesQuery);
  const fields = useTasteFields();
  const loraInfo = useQuery(loraInfoQuery);
  const saved = (next: Taste) => {
    client.setQueryData(tasteQuery.queryKey, next);
    void client.invalidateQueries({ queryKey: ["suggestions"], refetchType: "none" });
  };
  // A removed or pinned value makes its field the person's own, as Save in Edit does.
  const change = useMutation({
    mutationFn: (preferences: TastePreferenceChanges) =>
      api<Taste>("/api/taste", { method: "PUT", body: JSON.stringify({ preferences }) }),
    onSuccess: saved,
  });
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editing, setEditing] = useState(false);
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
  const error = refresh.error || taste.error || keepRates.error;
  const edited = (key: keyof TasteFields) =>
    !own(key) && Boolean(data && Object.hasOwn(data.preferences, key));
  const label = (key: keyof TasteFields) =>
    `${fieldLabels[key]}${edited(key) ? " · Your Edit" : ""}`;
  const loraLabel = (data: Taste, name: string) => {
    const strength = data.loraScores.find((lora) => lora.name === name)?.strength;
    return `${loraName(name, loraInfo.data?.loras[name])}${strength === undefined ? "" : ` ${strength}`}`;
  };
  const rates = keepRates.data;
  const ratedTables = (data: Taste, rates: KeepRates) => {
    const tags = fields.current(data, "tags");
    const shared = { change: change.mutate, pending: change.isPending };
    return (
      <>
        <KeepRateTable
          {...shared}
          title="Models"
          field="models"
          edited={edited("models")}
          favourites={fields.current(data, "models")}
          counts={rates.profiles}
          name={(id) => {
            const profile = fields.profileOf(id);
            return profile && profileName(profile);
          }}
        />
        <KeepRateTable
          {...shared}
          title="LoRAs"
          field="loras"
          edited={edited("loras")}
          favourites={fields.current(data, "loras")}
          counts={rates.loras}
          name={(name) => loraLabel(data, name)}
        />
        {tagGroups.map(([kind, title]) => (
          <KeepRateTable
            {...shared}
            key={title}
            title={title}
            field="tags"
            edited={edited("tags")}
            favourites={tags}
            counts={rates.tags}
            name={(tag) => tag}
            include={(tag) => tagKind(tag) === kind}
          />
        ))}
      </>
    );
  };
  return (
    <>
      {toolbar &&
        createPortal(
          <>
            <ToolbarAction
              label="Edit"
              icon={icons.edit}
              variant="default"
              disabled={!data || !fields.ready}
              onClick={() => setEditing(true)}
            />
            {data?.writer && (
              <ToolbarAction
                label="Refresh"
                icon={icons.refresh}
                iconOnly
                disabled={refresh.isPending || !data.signals}
                onClick={() => refresh.mutate()}
              />
            )}
          </>,
          toolbar,
        )}
      <SettingGroup title="Taste Profile">
        <Stack gap="xs">
          {taste.isPending && <LoadingState label="Loading Taste" />}
          {data && (
            <>
              <Text size="xs" c="dimmed">
                {learnt(data) ||
                  "Nothing learnt yet. Like, compare or iterate on results and Studio picks up your taste."}
              </Text>
              <Text size="sm">
                Dream and suggestion menus use your likes, dislikes and styles to guide new ideas.
                Rules apply to Dream. MCP uses the Exclusions list and otherwise runs your prompt as
                written, removing any excluded words a chat prompt names and saying so.
              </Text>
              <SettingRow
                label={label("note")}
                description={
                  <Text span size="sm" c="text" style={{ overflowWrap: "anywhere" }}>
                    {fields.current(data, "note") || "None"}
                  </Text>
                }
              />
              {wordKeys.map((key) => {
                const values = fields.current(data, key);
                const name = key === "shapes" ? shapeName : (value: string) => value;
                return (
                  <SettingRow
                    key={key}
                    label={label(key)}
                    description={
                      values.length ? (
                        <Group component="span" gap={4} mt={4}>
                          {values.map((value) => (
                            <Pill
                              key={value}
                              withRemoveButton
                              onRemove={() =>
                                change.mutate({ [key]: values.filter((other) => other !== value) })
                              }
                              // Pills inside an input hide their remove button from keyboards;
                              // these stand alone, so it is the only way to remove a value.
                              removeButtonProps={{
                                "aria-hidden": false,
                                tabIndex: 0,
                                "aria-label": `Remove ${name(value)}`,
                                disabled: change.isPending,
                              }}
                            >
                              {name(value)}
                            </Pill>
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
              })}
            </>
          )}
          {error && <Alert color="red">{error.message}</Alert>}
        </Stack>
      </SettingGroup>
      {data && rates && fields.ready && ratedTables(data, rates)}
      <TasteReflection />
      <ChatNotes />
      <SettingGroup title="Danger Zone" danger>
        <SettingRow
          label="Reset Learnt Taste"
          description="Forget the learnt summary, likes, dislikes and styles and learn them again from your signals. Your edits stay."
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
          description="Forget what Studio learnt and your own edits."
        >
          <Button
            size="compact-sm"
            color="red"
            variant="light"
            disabled={
              !data || (!data.summary && !data.signals && !Object.keys(data.preferences).length)
            }
            onClick={() => setClearing(true)}
          >
            Clear
          </Button>
        </SettingRow>
      </SettingGroup>
      <Modal
        id="taste-editor"
        opened={editing}
        onClose={closeWhenTop("taste-editor", () => setEditing(false))}
        title="Edit Taste"
        size="lg"
        fullScreen={phone}
      >
        {data && <TasteEditor data={data} onClose={() => setEditing(false)} saved={saved} />}
      </Modal>
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
        Studio forgets what it learnt and your edits. Your gallery and likes stay.
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
        Studio forgets the summary, likes, dislikes and styles it learnt and learns them again from
        your likes, comparisons and other signals. Your edits, exclusions and rules stay.
      </ConfirmDialog>
    </>
  );
}
