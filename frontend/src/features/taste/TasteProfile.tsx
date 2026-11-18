import { Alert, Button, Group, Modal, MultiSelect, Stack, TagsInput, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { loraName } from "../../../../shared/profiles";
import {
  type TasteFields,
  type TastePreferenceChanges,
  type TastePreferences,
  commonShapes,
  maxTastePhrase,
  maxTasteRule,
  shapeName,
  tasteLimits,
} from "../../../../shared/taste";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { isProfile, profileName } from "../generation/payload";

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
  likes: "Likes",
  avoid: "Dislikes",
  rules: "Rules",
  styles: "Styles",
  note: "Summary",
  models: "Models",
  loras: "LoRAs",
  shapes: "Shapes",
  tags: "Tags",
};
const fieldKeys = Object.keys(fieldLabels) as (keyof TasteFields)[];
/** Rules are only ever the person's: Studio learns none, so they have no learnt version. */
const own = (key: keyof TasteFields) => key === "rules";
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
          description='Limits every prompt keeps in Dream and chats, such as "always photographic, never CGI". Not a look to aim for.'
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
        value={draft[key]}
        onChange={set(key)}
        maxTags={tasteLimits[key]}
        maxLength={maxTastePhrase}
      />
    );
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
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
          <Button type="submit" loading={save.isPending} disabled={!Object.keys(changes).length}>
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}

/** The taste profile: each field learnt from feedback until the person sets it. */
export function TasteProfile() {
  const phone = usePhone();
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const fields = useTasteFields();
  const loraInfo = useQuery(loraInfoQuery);
  const [clearing, setClearing] = useState(false);
  const [editing, setEditing] = useState(false);
  const saved = (next: Taste) => client.setQueryData(tasteQuery.queryKey, next);
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
  const data = taste.data;
  const error = refresh.error || taste.error;
  const text = (data: Taste, key: keyof TasteFields) => {
    const value = fields.current(data, key);
    if (typeof value === "string") return value;
    const named = {
      models: (id: string) => profileName(fields.profileOf(id)!),
      loras: (name: string) => {
        const strength = data.loraScores.find((lora) => lora.name === name)?.strength;
        return `${loraName(name, loraInfo.data?.loras[name])}${strength === undefined ? "" : ` ${strength}`}`;
      },
      shapes: shapeName,
    }[key as "models" | "loras" | "shapes"];
    return (named ? value.map(named) : value).join("; ");
  };
  return (
    <>
      <SettingGroup
        title="Taste Profile"
        toolbar={
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<icons.edit size={16} />}
            disabled={!data || !fields.ready}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        }
      >
        <Stack gap="xs">
          {taste.isPending && <LoadingState label="Loading Taste" />}
          {data && (
            <>
              <Text size="xs" c="dimmed">
                {learnt(data) ||
                  "Nothing learnt yet. Like, compare or iterate on results and Studio picks up your taste."}
              </Text>
              {fieldKeys.map((key) => (
                <SettingRow
                  key={key}
                  label={`${fieldLabels[key]}${!own(key) && Object.hasOwn(data.preferences, key) ? " · Your Edit" : ""}`}
                  description={
                    <Text span size="sm" c="text" style={{ overflowWrap: "anywhere" }}>
                      {text(data, key) || "None"}
                    </Text>
                  }
                />
              ))}
            </>
          )}
          {error && <Alert color="red">{error.message}</Alert>}
          <Group gap="xs">
            {data?.writer && (
              <Button
                variant="default"
                leftSection={<icons.refresh size={16} />}
                loading={refresh.isPending}
                disabled={!data.signals}
                onClick={() => refresh.mutate()}
              >
                Refresh
              </Button>
            )}
            <Button
              variant="subtle"
              color="red"
              leftSection={<icons.clear size={16} />}
              disabled={
                !data || (!data.summary && !data.signals && !Object.keys(data.preferences).length)
              }
              onClick={() => setClearing(true)}
            >
              Clear
            </Button>
          </Group>
        </Stack>
      </SettingGroup>
      <Modal
        id="taste-editor"
        opened={editing}
        onClose={closeWhenTop("taste-editor", () => setEditing(false))}
        title="Edit Taste"
        size="lg"
        fullScreen={phone}
      >
        {editing && data && (
          <TasteEditor data={data} onClose={() => setEditing(false)} saved={saved} />
        )}
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
    </>
  );
}
