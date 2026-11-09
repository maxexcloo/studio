import { useState } from "react";
import { Alert, Button, Group, Stack, TagsInput, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SettingGroup } from "../../ui/SettingRows";
import { maxAvoid, maxAvoids } from "../../../../shared/taste";
import classes from "./TasteProfile.module.css";

export interface Taste {
  /** The profile in plain sentences, written by Studio from what it learnt. */
  summary: string;
  /** What the person asked Studio to avoid. */
  addedAvoid: string[];
  updatedAt: string;
  /** How many signals (stars, comparisons, iterations) the profile holds. */
  signals: number;
  /** Whether the text model may write this account's profile. */
  writer: boolean;
}
const tasteQuery = queryOptions({
  queryKey: ["taste"],
  queryFn: () => api<Taste>("/api/taste"),
});

const learnt = (taste: Taste) =>
  [
    taste.signals &&
      `Learnt from ${taste.signals} ${taste.signals === 1 ? "star, comparison or iteration" : "stars, comparisons and iterations"}`,
    taste.updatedAt &&
      `Updated ${new Date(taste.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Dream › Taste: what Studio learnt this account likes, and what its owner asks it to avoid. `fill`
 * fits it to the page's height, the summary taking the room above its actions.
 */
export function TasteProfile({ fill = false }: { fill?: boolean }) {
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const [clearing, setClearing] = useState(false);
  const saved = (next: Taste) => client.setQueryData(tasteQuery.queryKey, next);
  const avoid = useMutation({
    meta: { inlineError: true },
    mutationFn: (next: string[]) =>
      api<Taste>("/api/taste", { method: "PUT", body: JSON.stringify({ avoid: next }) }),
    onSuccess: saved,
  });
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
  const error = avoid.error || refresh.error || taste.error;
  return (
    <SettingGroup title="Taste Profile" fill={fill}>
      <Stack gap="xs" pt="xs" flex={fill ? 1 : undefined} mih={fill ? 0 : undefined}>
        {/* The minimum reserves the summary's height while the profile loads. */}
        <Text
          size="sm"
          mih="4lh"
          c={data?.summary ? undefined : "dimmed"}
          className={fill ? classes.fill : undefined}
        >
          {data &&
            (data.summary ||
              "Nothing learnt yet. Star, compare or iterate on results and Studio picks up your taste.")}
        </Text>
        <TagsInput
          label="Avoid"
          placeholder={data?.addedAvoid.length ? undefined : "Add something to avoid"}
          disabled={!data}
          maxTags={maxAvoids}
          maxLength={maxAvoid}
          value={avoid.isPending ? avoid.variables : (data?.addedAvoid ?? [])}
          onChange={(next) => {
            refresh.reset();
            avoid.mutate(next);
          }}
        />
        <Text size="xs" c="dimmed" mih="1lh">
          {data && learnt(data)}
        </Text>
        {error && <Alert color="red">{error.message}</Alert>}
        <Group gap="xs">
          {data?.writer && (
            <Button
              variant="default"
              loading={refresh.isPending}
              disabled={!data.signals}
              onClick={() => {
                avoid.reset();
                refresh.mutate();
              }}
            >
              Refresh
            </Button>
          )}
          <Button
            variant="subtle"
            color="red"
            disabled={!data?.summary && !data?.signals}
            onClick={() => setClearing(true)}
          >
            Clear
          </Button>
        </Group>
      </Stack>
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
        Studio forgets what it learnt and what you asked it to avoid. Your gallery and stars stay.
      </ConfirmDialog>
    </SettingGroup>
  );
}
