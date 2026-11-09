import { useState } from "react";
import { Alert, Badge, Button, Group, Stack, TagsInput, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SettingGroup } from "../../ui/SettingRows";
import { maxAvoid, maxAvoids } from "../../../../shared/taste";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery, loraTitle } from "../generation/LoraPicker";

interface Weighted {
  score: number;
}
export interface Taste {
  /** The profile in plain sentences, written by Studio from what it learnt. */
  summary: string;
  likes: string[];
  styles: string[];
  /** What Studio learnt they pass over. */
  avoid: string[];
  /** What the person asked Studio to avoid. */
  addedAvoid: string[];
  note: string;
  /** Scored profiles and LoRAs, best first. */
  profiles: Record<"image" | "video", ({ id: string } & Weighted)[]>;
  loras: ({ name: string; strength?: number } & Weighted)[];
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
/** The few best-liked entries, those scored above nothing. */
const top = <T extends Weighted>(entries: T[]) =>
  entries.filter((entry) => entry.score > 0).slice(0, 3);

/** One labelled row of chips; nothing where there are none. */
function Chips({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <Group gap={4} role="list" aria-label={label}>
      <Text size="xs" c="dimmed" w="4.5rem">
        {label}
      </Text>
      {values.map((value) => (
        <Badge key={value} role="listitem" maw="100%">
          {value}
        </Badge>
      ))}
    </Group>
  );
}

/**
 * Dream › Taste: a compact read-out of what Studio learnt this account likes (its words, best
 * models and LoRAs) and what its owner asks it to avoid. `fill` fits it to the page's height.
 */
export function TasteProfile({ fill = false }: { fill?: boolean }) {
  const client = useQueryClient();
  const taste = useQuery(tasteQuery);
  const models = useQuery(modelsQuery);
  const loraInfo = useQuery(loraInfoQuery);
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
  const profileName = (id: string) => {
    const profile = models.data?.profiles.find((entry) => entry.id === id);
    return profile?.displayName || profile?.label || id;
  };
  const known = data && (data.likes.length || data.styles.length || data.note || data.signals);
  return (
    <SettingGroup title="Taste Profile" fill={fill}>
      <Stack gap="xs" pt="xs" flex={fill ? 1 : undefined} mih={fill ? 0 : undefined}>
        {/* The minimum reserves room while the profile loads. */}
        <Stack gap={6} mih="4lh">
          {data &&
            (known ? (
              <>
                {data.note && (
                  <Text size="sm" lineClamp={3}>
                    {data.note}
                  </Text>
                )}
                <Chips label="Likes" values={data.likes.slice(0, 8)} />
                <Chips label="Styles" values={data.styles.slice(0, 6)} />
                <Chips label="Avoids" values={data.avoid.slice(0, 6)} />
                <Chips
                  label="Models"
                  values={top(
                    [...data.profiles.image, ...data.profiles.video].sort(
                      (a, b) => b.score - a.score,
                    ),
                  ).map((entry) => profileName(entry.id))}
                />
                <Chips
                  label="LoRAs"
                  values={top(data.loras).map(
                    (lora) =>
                      `${loraTitle(loraInfo.data?.loras[lora.name], lora.name)}${lora.strength === undefined ? "" : ` ${lora.strength}`}`,
                  )}
                />
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Nothing learnt yet. Star, compare or iterate on results and Studio picks up your
                taste.
              </Text>
            ))}
        </Stack>
        <TagsInput
          label="Always Avoid"
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
