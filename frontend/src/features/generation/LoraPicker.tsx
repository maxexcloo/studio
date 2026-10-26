import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Chip,
  Group,
  Image,
  NumberInput,
  Popover,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Layers, Star, X } from "lucide-react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoraStacks, loraLibraryQuery, type LoraLibrary } from "./LoraStacks";
import { OrderedItems } from "../../ui/OrderedItems";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { copyText } from "../../ui/clipboard";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";
import { api, post } from "../../api";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput } from "../../types";
import { isProfile } from "./payload";
import { usePhone } from "../../ui/usePhone";
import { chipProps, escapePanel } from "./chip";
import classes from "./LoraPicker.module.css";
import railClasses from "./GenerationInputControls.module.css";
import editorClasses from "./GenerationEditor.module.css";
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
  return { opened, setOpened, filter, setFilter, query, setQuery, controlsId, trigger, controls };
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
      {inline ? (
        <>
          <Group justify="space-between">
            <Button
              autoFocus
              size="compact-sm"
              variant="subtle"
              color="gray"
              leftSection={<ArrowLeft size={16} />}
              onClick={close}
            >
              Back
            </Button>
            <Text size="sm" fw={500}>
              LoRAs
            </Text>
          </Group>
          <LoraControls value={value} onChange={onChange} picker={picker} phone />
          <Box className={editorClasses.footer} data-sticky>
            <Button fullWidth onClick={close}>
              Use LoRAs
            </Button>
          </Box>
        </>
      ) : (
        <LoraControls value={value} onChange={onChange} picker={picker} />
      )}
    </Stack>
  );
  const enabled = input.loras.filter((lora) => lora.enabled !== false);
  const first = enabled[0] || input.loras[0];
  const summary = first
    ? `${loraTitle(info.data?.loras[first.name], first.name)}${input.loras.length > 1 ? ` +${input.loras.length - 1}` : ""}`
    : "LoRAs";
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
      leftSection={<Layers size={15} />}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={() => picker.setOpened(!picker.opened)}
    >
      <span className={railClasses.label}>{summary}</span>
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
}: {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
  phone?: boolean;
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
  const familyLabel = modelFamilyLabel(family, profile?.familyName);
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
    ? { title: "No LoRAs", text: `No installed LoRAs fit ${familyLabel}.` }
    : filter === "favourites" && !favourites.size
      ? { title: "No Favourites", text: "Star a LoRA to keep it here." }
      : { title: "No Matching LoRAs", text: "Try another search or filter." };
  const choices = info.isPending ? (
    <LoadingState label="Loading LoRAs" />
  ) : info.error ? (
    <Alert color="red">{info.error.message}</Alert>
  ) : shown.length ? (
    <div className={phone ? undefined : classes.grid} role="list" aria-label="Compatible LoRAs">
      {shown.map((file) => (
        <LoraChoice
          key={file}
          title={title(file)}
          type={typeNames[typeOf(file)] || typeOf(file)}
          preview={previews.data?.previews[file]}
          selected={selected.has(file)}
          favourite={favourites.has(file)}
          row={phone}
          onToggle={() => toggle(file)}
          onFavourite={() => favourite.mutate({ name: file, on: !favourites.has(file) })}
        />
      ))}
    </div>
  ) : (
    <EmptyState fill title={empty.title}>
      {empty.text}
    </EmptyState>
  );
  const browser = (
    <>
      <SearchInput
        data-autofocus
        size={phone ? "md" : "sm"}
        aria-label="Search LoRAs"
        placeholder="Search LoRAs"
        value={picker.query}
        onChange={(event) => picker.setQuery(event.currentTarget.value)}
        onClear={() => picker.setQuery("")}
      />
      <Chip.Group value={filter} onChange={(value) => picker.setFilter(value as string)}>
        <Group gap={6} className={classes.filters} role="radiogroup" aria-label="LoRA Filter">
          {[
            ["all", "All"],
            ["favourites", "Favourites"],
            ...types.map((type) => [type, typeNames[type] || type]),
          ].map(([value, label]) => (
            <Chip key={value} value={value} size={phone ? "md" : "xs"} variant="light">
              {label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </>
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
          Choose LoRAs to add them here.
        </Text>
      )}
      <LoraStacks
        key={family}
        family={family}
        profileId={profile?.id || ""}
        loras={input.loras}
        onLoad={update}
      />
    </>
  );
  if (phone)
    return (
      <Stack gap="sm">
        <Stack gap="xs">{stack}</Stack>
        {browser}
        {choices}
      </Stack>
    );
  return (
    <div className={classes.panel}>
      <div className={classes.column}>
        {browser}
        <ScrollArea flex={1} offsetScrollbars="present">
          {choices}
        </ScrollArea>
      </div>
      <ScrollArea className={`${classes.column} ${classes.stackColumn}`} offsetScrollbars="present">
        <Stack gap="xs">{stack}</Stack>
      </ScrollArea>
    </div>
  );
}

function LoraChoice({
  title,
  type,
  preview,
  selected,
  favourite,
  row,
  onToggle,
  onFavourite,
}: {
  title: string;
  type: string;
  preview?: string;
  selected: boolean;
  favourite: boolean;
  row: boolean;
  onToggle: () => void;
  onFavourite: () => void;
}) {
  const [state, setState] = useState<"loaded" | "failed">();
  return (
    <div
      className={classes.choice}
      role="listitem"
      data-row={row || undefined}
      data-selected={selected || undefined}
    >
      <UnstyledButton
        className={classes.toggle}
        aria-label={title}
        aria-pressed={selected}
        onClick={onToggle}
      >
        <div className={classes.preview}>
          <Layers size={row ? 18 : 22} aria-hidden />
          {preview && (
            <Image
              className={classes.image}
              src={preview}
              alt=""
              loading="lazy"
              decoding="async"
              data-loaded={state === "loaded" || undefined}
              data-failed={state === "failed" || undefined}
              onLoad={() => setState("loaded")}
              onError={() => setState("failed")}
            />
          )}
          {selected && (
            <span className={classes.check}>
              <Check size={14} strokeWidth={3} aria-hidden />
            </span>
          )}
        </div>
        <div className={classes.text}>
          <Text size="sm" fw={500} truncate>
            {title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {type}
          </Text>
        </div>
      </UnstyledButton>
      <ActionIcon
        className={classes.star}
        variant={row ? "subtle" : "default"}
        color="gray"
        aria-label={`Favourite ${title}`}
        aria-pressed={favourite}
        onClick={onFavourite}
      >
        <Star
          size={16}
          color={favourite ? "var(--mantine-color-yellow-filled)" : "currentColor"}
          fill={favourite ? "var(--mantine-color-yellow-filled)" : "none"}
        />
      </ActionIcon>
    </div>
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
