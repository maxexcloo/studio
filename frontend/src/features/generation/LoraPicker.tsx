import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Chip,
  Group,
  NumberInput,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Layers, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loraLibraryQuery, useLoraStacks, type LoraLibrary, type LoraRating } from "./LoraStacks";
import { OrderedItems } from "../../ui/OrderedItems";
import { copyText } from "../../ui/clipboard";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { api, post } from "../../api";
import { useRemembered } from "../auth/useRemembered";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput, Profile } from "../../types";
import { isProfile } from "./payload";
import { usePhone } from "../../ui/usePhone";
import { chipProps } from "./chip";
import {
  ChipPopup,
  ChipThumbnails,
  PickerFooter,
  PickerGrid,
  PickerHeader,
  PickerTile,
  SaveCurrent,
  SavedList,
  SortMenu,
  savedItems,
  type SavedSort,
} from "./Picker";
import classes from "./LoraPicker.module.css";
export interface LoraInfo {
  title?: string;
  sourceUrl?: string;
  families?: string[];
  type?: string;
  description?: string;
  role?: string;
  triggers?: string[];
  strengthRange?: { min: number; max: number; step: number; default?: number };
}
type Lora = GenerationInput["loras"][number];
export const loraInfoQuery = queryOptions({
  queryKey: ["lora-info"],
  queryFn: () => api<{ loras: Record<string, LoraInfo> }>("/api/loras/info"),
});
/** The newest own image made with each LoRA, by file name. */
const loraPreviewsQuery = queryOptions({
  queryKey: ["lora-previews"],
  queryFn: () => api<{ previews: Record<string, string> }>("/api/loras/previews"),
});
const typeNames: Record<string, string> = {
  slider: "Slider",
  style: "Style",
  character: "Character",
  concept: "Concept",
};
/** Recommended LoRAs match the profile's family; Favourites are this family's thumbs up; All lists every one. */
type LoraTab = "recommended" | "favourites" | "all" | "stacks";
/** All's filter for LoRAs without a model family. */
const unclassified = "unclassified";
/** A new LoRA starts at its catalogue default, else 1 kept within its published range. */
export const defaultStrength = (range: LoraInfo["strengthRange"]) =>
  range?.default ?? Math.min(Math.max(1, range?.min ?? 1), range?.max ?? 1);
export const loraTitle = (info: LoraInfo | undefined, file: string) =>
  info?.title || file.replace(/\.[^.]+$/, "");
/** The profile's LoRAs that suit its family; one without a family listed may suit any. */
export const compatibleLoras = (profile: Profile | undefined, metadata: Record<string, LoraInfo>) =>
  (profile?.options?.loras || []).filter((file) => {
    const families = metadata[file]?.families || [];
    return !families.length || families.includes(profile!.family);
  });

const ratingOrder = (rating?: LoraRating) => (rating === "up" ? 0 : rating === "down" ? 2 : 1);
/** Every LoRA list's order: thumbs up, then unrated, then thumbs down, each by title. */
export const byRating =
  (ratings: Record<string, LoraRating>, title: (file: string) => string) =>
  (a: string, b: string) =>
    ratingOrder(ratings[a]) - ratingOrder(ratings[b]) || title(a).localeCompare(title(b));

export function useLoraPicker() {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useRemembered<LoraTab>("lora-tab", "recommended");
  const [sort, setSort] = useState<SavedSort>("name-asc");
  const controlsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useLayoutEffect(() => {
    if (
      wasOpened.current &&
      !opened &&
      (document.activeElement === document.body ||
        controls.current?.contains(document.activeElement))
    ) {
      trigger.current?.focus({ preventScroll: true });
    }
    wasOpened.current = opened;
  }, [opened]);
  return {
    opened,
    setOpened,
    filter,
    setFilter,
    query,
    setQuery,
    tab,
    setTab,
    sort,
    setSort,
    controlsId,
    trigger,
    controls,
  };
}
export type LoraPickerState = ReturnType<typeof useLoraPicker>;
interface LoraPickerProps {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
}
export function LoraPicker({ value, onChange, picker }: LoraPickerProps) {
  const context = useGeneration();
  const input = value || context.input;
  // The picker's data loads with the chip, so its first frame is final.
  const info = useQuery(loraInfoQuery);
  useQuery(loraLibraryQuery);
  const previews = useQuery(loraPreviewsQuery);
  // Warms the preview images on intent, so the grid paints them on open.
  const warm = () => {
    for (const url of Object.values(previews.data?.previews || {}).slice(0, 40))
      new window.Image().src = url;
  };
  const trigger = (
    <Button
      ref={picker.trigger}
      {...chipProps}
      aria-label="Choose LoRAs"
      aria-expanded={picker.opened}
      aria-controls={picker.controlsId}
      leftSection={input.loras.length ? undefined : <Layers size={15} />}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={() => picker.setOpened(!picker.opened)}
    >
      {input.loras.length ? (
        <ChipThumbnails
          placeholder={Layers}
          items={input.loras.map((lora) => ({
            key: lora.name,
            label: loraTitle(info.data?.loras[lora.name], lora.name),
            src: previews.data?.previews[lora.name],
            off: lora.enabled === false,
          }))}
        />
      ) : (
        "LoRAs"
      )}
    </Button>
  );
  return (
    <ChipPopup
      title="LoRAs"
      position="top-end"
      width="min(46rem, calc(100vw - 2rem))"
      opened={picker.opened}
      onOpenedChange={picker.setOpened}
      target={trigger}
    >
      <Stack
        role="region"
        id={picker.controlsId}
        ref={picker.controls}
        aria-label="LoRA Controls"
        gap="sm"
        mih={0}
      >
        <LoraControls value={value} onChange={onChange} picker={picker} />
      </Stack>
    </ChipPopup>
  );
}

function useRating() {
  const cache = useQueryClient();
  return useMutation({
    // Ratings are set, not toggled, and run in order, so the last tap wins.
    scope: { id: "lora-library" },
    mutationFn: ({ name, rating }: { name: string; rating: LoraRating | null }) =>
      post<{ library: LoraLibrary }>("/api/loras/library/ops", {
        ops: [{ op: "rating", name, rating }],
      }),
    onMutate: ({ name, rating }) =>
      cache.setQueryData(loraLibraryQuery.queryKey, (old) => {
        if (!old) return old;
        const { [name]: _, ...ratings } = old.library.ratings || {};
        return {
          ...old,
          library: { ...old.library, ratings: rating ? { ...ratings, [name]: rating } : ratings },
        };
      }),
    onSuccess: ({ library }) =>
      cache.setQueryData(loraLibraryQuery.queryKey, { found: true, library }),
    onError: () => cache.invalidateQueries({ queryKey: loraLibraryQuery.queryKey }),
  });
}

function LoraControls({
  value,
  onChange,
  picker,
}: {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
}) {
  const phone = usePhone();
  const context = useGeneration();
  const input = value || context.input;
  const profile = value
    ? context.profiles.find((profile) => isProfile(profile, value.profileId))
    : context.profile;
  const update = (loras: Lora[]) =>
    onChange ? onChange({ ...input, loras }) : context.update({ loras });
  const info = useQuery(loraInfoQuery);
  const library = useQuery(loraLibraryQuery);
  const previews = useQuery(loraPreviewsQuery);
  const rate = useRating();
  const metadata = info.data?.loras || {};
  const family = profile?.family || "";
  const stacks = useLoraStacks(family, profile?.id || "");
  const title = (file: string) => loraTitle(metadata[file], file);
  const typeOf = (file: string) => metadata[file]?.type || "";
  const familiesOf = (file: string) => metadata[file]?.families || [];
  const available = profile?.options?.loras || [];
  const compatible = compatibleLoras(profile, metadata);
  const ratings = library.data?.library.ratings || {};
  const tab = picker.tab;
  const listed =
    tab === "recommended"
      ? available.filter((file) => familiesOf(file).includes(family))
      : tab === "favourites"
        ? compatible.filter((file) => ratings[file] === "up")
        : available;
  const types = [...new Set(listed.map(typeOf))].filter((type) => type).sort();
  const filters = [...(tab === "all" ? [unclassified] : []), ...types];
  const filter = filters.includes(picker.filter) ? picker.filter : "all";
  const terms = picker.query.trim().toLowerCase();
  const shown = listed
    .filter(
      (file) =>
        (filter === "all" ||
          (filter === unclassified ? !familiesOf(file).length : typeOf(file) === filter)) &&
        (!terms ||
          [title(file), file, ...(metadata[file]?.triggers || [])]
            .join(" ")
            .toLowerCase()
            .includes(terms)),
    )
    .sort(byRating(ratings, title));
  const selected = new Set(input.loras.map((lora) => lora.name));
  const toggle = (file: string) =>
    update(
      selected.has(file)
        ? input.loras.filter((lora) => lora.name !== file)
        : [
            ...input.loras,
            {
              name: file,
              strength: defaultStrength(metadata[file]?.strengthRange),
              enabled: true,
              triggers: true,
            },
          ],
    );
  const enabledCount = input.loras.filter((lora) => lora.enabled !== false).length;
  const empty =
    terms || filter !== "all"
      ? "No Matching LoRAs"
      : tab === "recommended"
        ? "No Recommended LoRAs"
        : tab === "favourites"
          ? "No Favourites"
          : "No LoRAs";
  const choices =
    picker.tab === "stacks" ? (
      <SavedList
        label="Saved LoRA Stacks"
        noun="Stack"
        items={savedItems(stacks.records, picker.query, picker.sort)}
        empty={stacks.records.length ? "No Matching Stacks" : "No Saved Stacks"}
        replaces={input.loras.length > 0}
        replaceMessage="Replace the current LoRAs with this stack?"
        onLoad={(record) => update(record.stack.loras.map((lora) => ({ ...lora })))}
        onRename={stacks.rename}
        onUpdate={(record) => stacks.update(record, input.loras)}
        onDelete={stacks.remove}
      />
    ) : info.isPending ? (
      <LoadingState label="Loading LoRAs" />
    ) : info.error ? (
      <Alert color="red">{info.error.message}</Alert>
    ) : shown.length ? (
      <PickerGrid label="LoRA Choices" rows={phone}>
        {shown.map((file) => (
          <PickerTile
            key={file}
            label={title(file)}
            title={title(file)}
            detail={
              typeNames[typeOf(file)] ||
              typeOf(file) ||
              (familiesOf(file).length ? undefined : "Unclassified")
            }
            image={previews.data?.previews[file]}
            placeholder={Layers}
            aspect={phone ? "1" : "4 / 3"}
            selected={selected.has(file)}
            row={phone}
            onToggle={() => toggle(file)}
            action={
              <Group gap={4} wrap="nowrap">
                {(
                  [
                    ["up", "Thumbs Up", ThumbsUp, "green"],
                    ["down", "Thumbs Down", ThumbsDown, "red"],
                  ] as const
                ).map(([rating, label, Icon, color]) => (
                  <ActionIcon
                    key={rating}
                    variant={phone ? "subtle" : "default"}
                    color="gray"
                    aria-label={`${label} ${title(file)}`}
                    aria-pressed={ratings[file] === rating}
                    onClick={() =>
                      rate.mutate({ name: file, rating: ratings[file] === rating ? null : rating })
                    }
                  >
                    <Icon
                      size={16}
                      color={
                        ratings[file] === rating
                          ? `var(--mantine-color-${color}-filled)`
                          : "currentColor"
                      }
                    />
                  </ActionIcon>
                ))}
              </Group>
            }
          />
        ))}
      </PickerGrid>
    ) : (
      <EmptyState fill>{empty}</EmptyState>
    );
  const header = (
    <PickerHeader
      label="LoRAs"
      searched={picker.tab === "stacks" ? "Stacks" : "LoRAs"}
      tabs={[
        { value: "recommended", label: "Recommended" },
        { value: "favourites", label: "Favourites" },
        { value: "all", label: "All" },
        { value: "stacks", label: "Stacks" },
      ]}
      tab={picker.tab}
      onTabChange={picker.setTab}
      query={picker.query}
      onQueryChange={picker.setQuery}
      placeholder={picker.tab === "stacks" ? "Search stacks…" : "Search LoRAs…"}
      actions={
        picker.tab === "stacks" && <SortMenu value={picker.sort} onChange={picker.setSort} />
      }
      filterCount={filter === "all" ? 0 : 1}
      filters={
        picker.tab !== "stacks" &&
        filters.length > 0 && (
          <Chip.Group value={filter} onChange={(value) => picker.setFilter(value as string)}>
            <Group gap={6} role="radiogroup" aria-label="LoRA Filter">
              {[
                ["all", "Any"],
                ...filters.map((value) => [
                  value,
                  value === unclassified ? "Unclassified" : typeNames[value] || value,
                ]),
              ].map(([value, label]) => (
                <Chip key={value} value={value} variant="light">
                  {label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )
      }
    />
  );
  const stack = (
    <>
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          Stack
        </Text>
        {!!profile?.maxLoras && (
          <Text size="xs" c={enabledCount > profile.maxLoras ? "yellow" : "dimmed"}>
            {enabledCount} of {profile.maxLoras} Enabled
          </Text>
        )}
      </Group>
      {!!profile?.maxLoras && enabledCount > profile.maxLoras && (
        <Text size="xs" c="yellow">
          This profile supports up to {profile.maxLoras} enabled LoRAs. Disable or remove extras
          before generating.
        </Text>
      )}
      {input.loras.length ? (
        <OrderedItems
          kind="loras"
          items={input.loras}
          identity={(lora) => lora.name}
          label={(lora) => title(lora.name)}
          onChange={update}
        >
          {(lora) => (
            <StackEntry
              lora={lora}
              title={title(lora.name)}
              info={metadata[lora.name]}
              compatible={compatible.includes(lora.name)}
              onChange={(patch) =>
                update(
                  input.loras.map((item) =>
                    item.name === lora.name ? { ...item, ...patch } : item,
                  ),
                )
              }
              onRemove={() => update(input.loras.filter((item) => item.name !== lora.name))}
            />
          )}
        </OrderedItems>
      ) : (
        <Text size="sm" c="dimmed">
          Choose LoRAs or a saved stack to add them here.
        </Text>
      )}
    </>
  );
  const footer = (
    <PickerFooter
      start={
        <SaveCurrent
          noun="Stack"
          disabled={!input.loras.length || !stacks.ready}
          onSave={(name) => stacks.save(name, input.loras)}
        />
      }
      end={
        <Button variant="default" disabled={!input.loras.length} onClick={() => update([])}>
          Clear LoRAs
        </Button>
      }
    />
  );
  if (phone)
    return (
      <>
        <Stack gap="xs">{stack}</Stack>
        {header}
        {choices}
        {footer}
      </>
    );
  return (
    <Stack gap="sm">
      <div className={classes.panel}>
        <div className={classes.column}>
          {header}
          <ScrollArea flex={1} offsetScrollbars="present">
            {choices}
          </ScrollArea>
        </div>
        <ScrollArea
          className={`${classes.column} ${classes.stackColumn}`}
          offsetScrollbars="present"
        >
          <Stack gap="xs">{stack}</Stack>
        </ScrollArea>
      </div>
      {footer}
    </Stack>
  );
}

function StackEntry({
  lora,
  title,
  info,
  compatible,
  onChange,
  onRemove,
}: {
  lora: Lora;
  title: string;
  info?: LoraInfo;
  compatible: boolean;
  onChange: (patch: Partial<Lora>) => void;
  onRemove: () => void;
}) {
  // Dragging previews locally and commits once, so the draft doesn't rerender every frame.
  const [dragging, setDragging] = useState<number | null>(null);
  const range = info?.strengthRange;
  const step = range?.step ?? 0.05;
  // The catalogue's published range bounds the control; without one, 0 to 2.
  const min = range?.min ?? 0;
  const max = range?.max ?? 2;
  const strength = dragging ?? lora.strength;
  const enabled = lora.enabled !== false;
  return (
    <Stack gap={6} className={classes.entry} data-disabled={!enabled || undefined}>
      <Group gap="xs" wrap="nowrap">
        <Switch
          classNames={{ root: classes.enable, body: classes.enable, labelWrapper: classes.enable }}
          label={
            <Text size="sm" fw={500} truncate>
              {title}
            </Text>
          }
          aria-label={`Enable ${title}`}
          checked={enabled}
          onChange={(event) => onChange({ enabled: event.currentTarget.checked })}
        />
        <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${title}`} onClick={onRemove}>
          <X size={16} />
        </ActionIcon>
      </Group>
      <Stack gap={6} className={classes.details}>
        <Group gap="sm" wrap="nowrap">
          <Slider
            flex={1}
            size="sm"
            min={min}
            max={max}
            step={step}
            value={strength}
            thumbLabel={`${title} Strength`}
            marks={range?.default !== undefined ? [{ value: range.default }] : undefined}
            onChange={setDragging}
            onChangeEnd={(value) => {
              setDragging(null);
              onChange({ strength: value });
            }}
          />
          <NumberInput
            size="xs"
            w={76}
            aria-label={`${title} Strength`}
            value={strength}
            min={min}
            max={max}
            clampBehavior="blur"
            hideControls
            step={step}
            onChange={(value) => {
              if (value !== "" && Number.isFinite(Number(value)))
                onChange({ strength: Number(value) });
            }}
          />
        </Group>
        {range && (
          <Text size="xs" c="dimmed">
            Suggested {range.min} to {range.max}
            {range.default !== undefined && `, default ${range.default}`}
          </Text>
        )}
        {!compatible && (
          <Text size="xs" c="yellow">
            This LoRA is unavailable for the selected profile. Disable or remove it before
            generating.
          </Text>
        )}
        {!!info?.triggers?.length && (
          <Group gap={4}>
            <Switch
              label="Trigger Words"
              aria-label={`${title} Trigger Words`}
              checked={lora.triggers !== false}
              onChange={(event) => onChange({ triggers: event.currentTarget.checked })}
              mr={4}
            />
            {info.triggers.map((word) => (
              <Button
                key={word}
                size="compact-sm"
                variant="subtle"
                aria-label={`Copy Trigger Word: ${word}`}
                onClick={() => void copyText(word, "Trigger Word")}
              >
                {word}
              </Button>
            ))}
          </Group>
        )}
        {info?.description && (
          <Text size="xs" c="dimmed" lineClamp={3}>
            {info.description}
          </Text>
        )}
        {info?.sourceUrl && (
          <Anchor size="xs" href={info.sourceUrl} target="_blank" rel="noopener noreferrer">
            View Source
          </Anchor>
        )}
      </Stack>
    </Stack>
  );
}
