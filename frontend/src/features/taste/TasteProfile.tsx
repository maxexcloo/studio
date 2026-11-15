import { Alert, Button, Group, Modal, ScrollArea, Stack, TagsInput, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { loraName } from "../../../../shared/profiles";
import {
  type TastePreferenceChanges,
  type TastePreferences,
  type TasteWords,
  maxAvoid,
  maxAvoids,
  tasteWordLimits,
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

interface Weighted {
  score: number;
}
export interface Taste extends TasteWords {
  summary: string;
  addedAvoid: string[];
  learnt: TasteWords;
  preferences: TastePreferences;
  profiles: Record<"image" | "video", ({ id: string } & Weighted)[]>;
  loras: ({ name: string; strength?: number } & Weighted)[];
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
const top = <T extends Weighted>(entries: T[]) =>
  entries.filter((entry) => entry.score > 0).slice(0, 3);
const wordLabels = { likes: "Likes", styles: "Styles", avoid: "Avoids", note: "Summary" } as const;
const wordKeys = Object.keys(wordLabels) as (keyof TasteWords)[];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function TasteEditor({
  data,
  onClose,
  saved,
}: {
  data: Taste;
  onClose: () => void;
  saved: (next: Taste) => void;
}) {
  const [draft, setDraft] = useState<TasteWords>({
    likes: data.likes,
    styles: data.styles,
    avoid: data.avoid,
    note: data.note,
  });
  const [resets, setResets] = useState(new Set<keyof TasteWords>());
  const [addedAvoid, setAddedAvoid] = useState(data.addedAvoid);
  const changes: TastePreferenceChanges = Object.fromEntries(
    wordKeys
      .filter((key) => resets.has(key) || !same(draft[key], data[key]))
      .map((key) => [key, same(draft[key], data.learnt[key]) ? null : draft[key]]),
  );
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api<Taste>("/api/taste", {
        method: "PUT",
        body: JSON.stringify({
          ...(!same(addedAvoid, data.addedAvoid) && { avoid: addedAvoid }),
          ...(Object.keys(changes).length && { preferences: changes }),
        }),
      }),
    onSuccess: (next) => {
      saved(next);
      onClose();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Your edits stay when Studio refreshes what it learnt. Remove entries with their ×, or
          return a field to what Studio learnt.
        </Text>
        {wordKeys.map((key) => (
          <Stack key={key} gap={4}>
            {key === "note" ? (
              <TextBox
                label={wordLabels[key]}
                value={draft.note}
                onChange={(note) => setDraft({ ...draft, note })}
                autosize
                minRows={3}
                maxLength={tasteWordLimits.note}
              />
            ) : (
              <TagsInput
                label={wordLabels[key]}
                value={draft[key]}
                onChange={(value) => setDraft({ ...draft, [key]: value })}
                maxTags={tasteWordLimits[key]}
                maxLength={maxAvoid}
              />
            )}
            {((Object.hasOwn(data.preferences, key) && !resets.has(key)) ||
              !same(draft[key], data.learnt[key])) && (
              <Button
                size="compact-sm"
                variant="subtle"
                w="fit-content"
                onClick={() => {
                  setDraft({ ...draft, [key]: data.learnt[key] });
                  setResets(new Set([...resets, key]));
                }}
              >
                Use Learnt {wordLabels[key]}
              </Button>
            )}
          </Stack>
        ))}
        <TagsInput
          label="Always Avoid"
          description="Your explicit avoids, kept separately from learnt preferences."
          value={addedAvoid}
          onChange={setAddedAvoid}
          maxTags={maxAvoids}
          maxLength={maxAvoid}
        />
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        <DialogFooter pending={save.isPending} onCancel={onClose}>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!Object.keys(changes).length && same(addedAvoid, data.addedAvoid)}
          >
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}

/** Taste words and explicit preferences, with model scores still learnt from feedback. */
export function TasteProfile({ fill = false }: { fill?: boolean }) {
  const phone = usePhone();
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const models = useQuery(modelsQuery);
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
  const modelName = (id: string) => {
    const profile = models.data?.profiles.find((entry) => isProfile(entry, id));
    return profile ? profileName(profile) : "Unavailable Model";
  };
  const description = (text: string) => (
    <Text span size="sm" c="text" style={{ overflowWrap: "anywhere" }}>
      {text || "None"}
    </Text>
  );
  return (
    <>
      <SettingGroup
        title="Taste Profile"
        fill={fill}
        toolbar={
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<icons.edit size={16} />}
            disabled={!data}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        }
      >
        <ScrollArea flex={fill ? 1 : undefined} mih={0}>
          <Stack gap="xs">
            {taste.isPending && <LoadingState label="Loading Taste" />}
            {data && (
              <>
                <Text size="xs" c="dimmed">
                  {learnt(data) ||
                    "Nothing learnt yet. Like, compare or iterate on results and Studio picks up your taste."}
                </Text>
                {wordKeys.map((key) => (
                  <SettingRow
                    key={key}
                    label={`${wordLabels[key]}${Object.hasOwn(data.preferences, key) ? " · Your Edit" : ""}`}
                    description={description(key === "note" ? data.note : data[key].join("; "))}
                  />
                ))}
                <SettingRow
                  label="Models"
                  description={description(
                    top(
                      [...data.profiles.image, ...data.profiles.video].sort(
                        (a, b) => b.score - a.score,
                      ),
                    )
                      .map((entry) => modelName(entry.id))
                      .join("; "),
                  )}
                />
                <SettingRow
                  label="LoRAs"
                  description={description(
                    top(data.loras)
                      .map(
                        (lora) =>
                          `${loraName(lora.name, loraInfo.data?.loras[lora.name])}${lora.strength === undefined ? "" : ` ${lora.strength}`}`,
                      )
                      .join("; "),
                  )}
                />
                <SettingRow
                  label="Always Avoid"
                  description={description(data.addedAvoid.join("; "))}
                />
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
                disabled={
                  !data ||
                  (!data.summary &&
                    !data.signals &&
                    !data.addedAvoid.length &&
                    !Object.keys(data.preferences).length)
                }
                onClick={() => setClearing(true)}
              >
                Clear
              </Button>
            </Group>
          </Stack>
        </ScrollArea>
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
        Studio forgets what it learnt and your edits, including what you asked it to avoid. Your
        gallery and likes stay.
      </ConfirmDialog>
    </>
  );
}
