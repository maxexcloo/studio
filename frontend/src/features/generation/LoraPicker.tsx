import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Chip,
  Group,
  NumberInput,
  Popover,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Layers, Star, X } from "lucide-react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loraLibraryQuery, useLoraStacks, type LoraLibrary } from "./LoraStacks";
import { OrderedItems } from "../../ui/OrderedItems";
import { copyText } from "../../ui/clipboard";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { api, post } from "../../api";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput } from "../../types";
import { isProfile } from "./payload";
import { usePhone } from "../../ui/usePhone";
import { chipProps, escapePanel } from "./chip";
import {
  ChipThumbnails,
  PanelHeader,
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
interface LoraInfo {
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
  unclassified: "Unclassified",
};
const loraTitle = (info: LoraInfo | undefined, file: string) =>
  info?.title || file.replace(/\.[^.]+$/, "");

export function useLoraPicker() {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"loras" | "stacks">("loras");
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
  inline?: boolean;
}
export function LoraPicker({ value, onChange, picker, inline = false }: LoraPickerProps) {
  const context = useGeneration();
  const input = value || context.input;
  const phone = usePhone();
  // The picker's data loads with the chip, so its first frame is final.
  const info = useQuery(loraInfoQuery);
  useQuery(loraLibraryQuery);
  const previews = useQuery(loraPreviewsQuery);
  const close = () => picker.setOpened(false);
  const content = (
    <Stack
      role="region"
      id={picker.controlsId}
      ref={picker.controls}
      aria-label="LoRA Controls"
      data-composer-layer
      gap="sm"
      flex={inline ? 1 : undefined}
      mih={0}
    >
      {inline && <PanelHeader title="LoRAs" onBack={close} />}
      <LoraControls
        value={value}
        onChange={onChange}
        picker={picker}
        phone={inline}
        onDone={inline ? close : undefined}
      />
    </Stack>
  );
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
  if (inline) return content;
  // Phones show the controls inline in place of the form (see GenerationEditor).
  if (phone) return trigger;
  return (
    <Popover
      opened={picker.opened}
      onChange={picker.setOpened}
      position="top-end"
      width="min(56rem, calc(100vw - 2rem))"
      trapFocus
      shadow="md"
      returnFocus
      closeOnEscape={false}
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown data-composer-layer onKeyDown={(event) => escapePanel(event, close)}>
        {content}
      </Popover.Dropdown>
    </Popover>
  );
}

function useFavourite() {
  const cache = useQueryClient();
  const set = (change: (favorites: string[]) => string[], library?: LoraLibrary) =>
    cache.setQueryData(loraLibraryQuery.queryKey, (old) =>
      library
        ? { found: true, library }
        : old && {
            ...old,
            library: { ...old.library, favorites: change(old.library.favorites || []) },
          },
    );
  return useMutation({
    // Favourites are set, not toggled, and run in order, so the last tap wins.
    scope: { id: "lora-library" },
    mutationFn: ({ name, on }: { name: string; on: boolean }) =>
      post<{ library: LoraLibrary }>("/api/loras/library/ops", {
        ops: [{ op: "favorite", name, on }],
      }),
    onMutate: ({ name, on }) =>
      set((favorites) =>
        on ? [...new Set([...favorites, name])] : favorites.filter((item) => item !== name),
      ),
    onSuccess: ({ library }) => set((favorites) => favorites, library),
    onError: () => cache.invalidateQueries({ queryKey: loraLibraryQuery.queryKey }),
  });
}

function LoraControls({
  value,
  onChange,
  picker,
  phone = false,
  onDone,
}: {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
  phone?: boolean;
  onDone?: () => void;
}) {
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
  const favourite = useFavourite();
  const metadata = info.data?.loras || {};
  const family = profile?.family || "";
  const stacks = useLoraStacks(family, profile?.id || "");
  const title = (file: string) => loraTitle(metadata[file], file);
  const typeOf = (file: string) => metadata[file]?.type || "unclassified";
  const compatible = (profile?.options?.loras || []).filter(
    (file) => !metadata[file]?.families?.length || metadata[file].families!.includes(family),
  );
  const types = [...new Set(compatible.map(typeOf))].sort();
  const favourites = new Set(library.data?.library.favorites || []);
  const filter =
    picker.filter === "favourites" || types.includes(picker.filter) ? picker.filter : "all";
  const terms = picker.query.trim().toLowerCase();
  const shown = compatible
    .filter(
      (file) =>
        (filter === "all" ||
          (filter === "favourites" ? favourites.has(file) : typeOf(file) === filter)) &&
        (!terms ||
          [title(file), file, ...(metadata[file]?.triggers || [])]
            .join(" ")
            .toLowerCase()
            .includes(terms)),
    )
    .sort(
      (a, b) =>
        Number(favourites.has(b)) - Number(favourites.has(a)) || title(a).localeCompare(title(b)),
    );
  const selected = new Set(input.loras.map((lora) => lora.name));
  const toggle = (file: string) =>
    update(
      selected.has(file)
        ? input.loras.filter((lora) => lora.name !== file)
        : [
            ...input.loras,
            {
              name: file,
              strength: metadata[file]?.strengthRange?.default ?? 1,
              enabled: true,
              triggers: true,
            },
          ],
    );
  const enabledCount = input.loras.filter((lora) => lora.enabled !== false).length;
  const empty = !compatible.length
    ? "No LoRAs"
    : filter === "favourites" && !favourites.size
      ? "No Favourites"
      : "No Matching LoRAs";
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
      <PickerGrid label="Compatible LoRAs" rows={phone}>
        {shown.map((file) => (
          <PickerTile
            key={file}
            label={title(file)}
            title={title(file)}
            detail={typeNames[typeOf(file)] || typeOf(file)}
            image={previews.data?.previews[file]}
            placeholder={Layers}
            aspect={phone ? "1" : "4 / 3"}
            selected={selected.has(file)}
            row={phone}
            onToggle={() => toggle(file)}
            action={
              <ActionIcon
                variant={phone ? "subtle" : "default"}
                color="gray"
                aria-label={`Favourite ${title(file)}`}
                aria-pressed={favourites.has(file)}
                onClick={() => favourite.mutate({ name: file, on: !favourites.has(file) })}
              >
                <Star
                  size={16}
                  color={
                    favourites.has(file) ? "var(--mantine-color-yellow-filled)" : "currentColor"
                  }
                  fill={favourites.has(file) ? "var(--mantine-color-yellow-filled)" : "none"}
                />
              </ActionIcon>
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
        { value: "loras", label: "LoRAs" },
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
        picker.tab === "loras" && (
          <Chip.Group value={filter} onChange={(value) => picker.setFilter(value as string)}>
            <Group gap={6} role="radiogroup" aria-label="LoRA Filter">
              {[
                ["all", "All"],
                ["favourites", "Favourites"],
                ...types.map((type) => [type, typeNames[type] || type]),
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
      done={onDone && { label: "Use LoRAs", onClick: onDone }}
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
            min={Math.min(0, range?.min ?? 0)}
            max={Math.max(2, range?.max ?? 2)}
            step={step}
            value={strength}
            thumbLabel={`${title} Strength`}
            marks={range ? [{ value: range.min }, { value: range.max }] : undefined}
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
            clampBehavior="none"
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
              size="xs"
              label="Trigger Words"
              aria-label={`${title} Trigger Words`}
              checked={lora.triggers !== false}
              onChange={(event) => onChange({ triggers: event.currentTarget.checked })}
              mr={4}
            />
            {info.triggers.map((word) => (
              <Button
                key={word}
                size="compact-xs"
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
