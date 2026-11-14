import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Chip,
  Group,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  type PopoverProps,
} from "@mantine/core";
import { useState } from "react";
import { ChevronDown, ThumbsDown, ThumbsUp } from "lucide-react";
import { icons } from "../../ui/icons";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loraLibraryQuery, type LoraLibrary, type LoraRating } from "./loraLibrary";
import { usePresets, type Preset } from "./PresetPicker";
import { OrderedItems } from "../../ui/OrderedItems";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { api, post } from "../../api";
import { useRemembered } from "../auth/useRemembered";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput, Profile } from "../../types";
import { isProfile, profileForBackend } from "./payload";
import { StrengthControl } from "./StrengthControl";
import { loraDefaultStrength, loraFamilyId } from "../../../../shared/profiles";
import { usePhone } from "../../ui/usePhone";
import { chipProps } from "./chip";
import {
  ChipPopup,
  ChipContent,
  PickerGrid,
  PickerHeader,
  PickerTile,
  PopupHeading,
  SaveButton,
  SavedName,
  SortMenu,
  useNaming,
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
  recommendedStrength?: number;
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
/** Which LoRAs the picker lists: every one the profile can load, or the thumbs up among them. */
const loraTabs = [
  { value: "all", label: "All" },
  // The stored tab value keeps its earlier name.
  { value: "favourites", label: "Starred" },
] as const;
type LoraTab = (typeof loraTabs)[number]["value"];
/** A new LoRA starts at its catalogue default, else 1 kept within its published range. */
const defaultStrength = (info: LoraInfo | undefined) => loraDefaultStrength(info, 1);
export const loraTitle = (info: LoraInfo | undefined, file: string) =>
  info?.title || file.replace(/\.[^.]+$/, "");
/** Whether a LoRA lists the profile's family, however the profile spells it. */
const fitsFamily = (families: string[], family: string) =>
  families.some((value) => loraFamilyId(value) === loraFamilyId(family));
/** The profile's LoRAs that suit its family; one without a family listed may suit any. */
export const compatibleLoras = (profile: Profile | undefined, metadata: Record<string, LoraInfo>) =>
  (profile?.options?.loras || []).filter((file) => {
    const families = metadata[file]?.families || [];
    return !families.length || fitsFamily(families, profile!.family);
  });

const ratingOrder = (rating?: LoraRating) => (rating === "up" ? 0 : rating === "down" ? 2 : 1);
/** The LoRA choices' orders: by rating (the default every LoRA list shares), or by name. */
type LoraSort = "rating" | "name-asc" | "name-desc";
const loraSortLabels: Record<LoraSort, string> = {
  rating: "Rating",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};
/** Every LoRA list's order: thumbs up, then unrated, then thumbs down, each by title. */
const byRating =
  (ratings: Record<string, LoraRating>, title: (file: string) => string) =>
  (a: string, b: string) =>
    ratingOrder(ratings[a]) - ratingOrder(ratings[b]) || title(a).localeCompare(title(b));

export function useLoraPicker() {
  const [opened, setOpened] = useState(false);
  // The family the list shows; null shows the profile's.
  const [family, setFamily] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useRemembered<LoraTab>("lora-tab", "all");
  const [loraSort, setLoraSort] = useState<LoraSort>("rating");
  // The preset the stack was loaded from or saved as, and its name field's state.
  const [presetId, setPresetId] = useState<string>();
  const naming = useNaming();
  return {
    opened,
    setOpened,
    family,
    setFamily,
    query,
    setQuery,
    tab,
    setTab,
    loraSort,
    setLoraSort,
    presetId,
    setPresetId,
    naming,
  };
}
export type LoraPickerState = ReturnType<typeof useLoraPicker>;
interface LoraPickerProps {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
  /** Where the desktop popup opens: above the composer's rail by default. */
  position?: PopoverProps["position"];
}
export function LoraPicker({ value, onChange, picker, position = "top-end" }: LoraPickerProps) {
  const context = useGeneration();
  const input = value || context.input;
  const phone = usePhone();
  const [adding, setAdding] = useState(false);
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
      {...chipProps}
      aria-label="Choose LoRAs"
      aria-expanded={picker.opened}
      rightSection={<ChevronDown size={14} />}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={() => picker.setOpened(!picker.opened)}
    >
      <ChipContent
        label="LoRAs"
        icon={icons.loras}
        items={input.loras.map((lora) => ({
          key: lora.name,
          label: loraTitle(info.data?.loras[lora.name], lora.name),
          src: previews.data?.previews[lora.name],
          off: lora.enabled === false,
        }))}
      />
    </Button>
  );
  const choices = <LoraChoices value={value} onChange={onChange} picker={picker} />;
  const stack = <LoraStack value={value} onChange={onChange} picker={picker} />;
  // Phones open the stack, with Add LoRAs opening the choices in a sheet over it.
  if (phone)
    return (
      <ChipPopup
        title="LoRAs"
        width="100%"
        opened={picker.opened}
        onOpenedChange={(opened) => {
          picker.setOpened(opened);
          if (!opened) setAdding(false);
        }}
        target={trigger}
        headerEnd={<StackActions value={value} onChange={onChange} picker={picker} />}
        footer={{
          apply: true,
          start: (
            <ChipPopup
              title="Add LoRAs"
              width="100%"
              opened={adding}
              onOpenedChange={setAdding}
              target={
                // "Add" keeps the footer to one row beside Clear, Save Stack and Apply.
                <Button variant="default" aria-label="Add LoRAs" onClick={() => setAdding(true)}>
                  Add
                </Button>
              }
              footer={{ apply: true }}
            >
              {choices}
            </ChipPopup>
          ),
        }}
      >
        {stack}
      </ChipPopup>
    );
  return (
    <ChipPopup
      title="LoRAs"
      position={position}
      width="min(46rem, calc(100vw - 2rem))"
      opened={picker.opened}
      onOpenedChange={picker.setOpened}
      target={trigger}
      aside={stack}
    >
      {choices}
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
/** A LoRA's thumbs up and down for the account; tapping the pressed one clears it. */
export function LoraThumbs({ file, title }: { file: string; title: string }) {
  const library = useQuery(loraLibraryQuery);
  const rate = useRating();
  const current = library.data?.library.ratings?.[file];
  return (
    <Group gap={4} wrap="nowrap">
      {(
        [
          ["up", "Thumbs Up", ThumbsUp, "green"],
          ["down", "Thumbs Down", ThumbsDown, "red"],
        ] as const
      ).map(([rating, label, Icon, color]) => (
        <ActionIcon
          key={rating}
          variant="subtle"
          color="gray"
          aria-label={`${label} ${title}`}
          aria-pressed={current === rating}
          onClick={() => rate.mutate({ name: file, rating: current === rating ? null : rating })}
        >
          <Icon
            size={16}
            color={current === rating ? `var(--mantine-color-${color}-filled)` : "currentColor"}
          />
        </ActionIcon>
      ))}
    </Group>
  );
}

/** The draft, profile and catalogue the LoRA choices and stack share. */
function useLoraDraft({ value, onChange }: Omit<LoraPickerProps, "picker">) {
  const context = useGeneration();
  const input = value || context.input;
  const profile = profileForBackend(
    value
      ? context.profiles.find((profile) => isProfile(profile, value.profileId))
      : context.profile,
    input.profileBackend,
    Boolean(input.referenceAssets?.length),
  );
  const update = (loras: Lora[]) =>
    onChange ? onChange({ ...input, loras }) : context.update({ loras });
  const info = useQuery(loraInfoQuery);
  const metadata = info.data?.loras || {};
  const title = (file: string) => loraTitle(metadata[file], file);
  return {
    input,
    profile,
    update,
    info,
    metadata,
    title,
    compatible: compatibleLoras(profile, metadata),
  };
}

/** The LoRAs to choose from: tabs, search, family and sort over the list. */
function LoraChoices({ value, onChange, picker }: LoraPickerProps) {
  const { input, profile, update, info, metadata, title } = useLoraDraft({
    value,
    onChange,
  });
  const library = useQuery(loraLibraryQuery);
  const previews = useQuery(loraPreviewsQuery);
  const typeOf = (file: string) => metadata[file]?.type || "";
  const familiesOf = (file: string) => metadata[file]?.families || [];
  const available = profile?.options?.loras || [];
  const ratings = library.data?.library.ratings || {};
  // A tab remembered from before shows All.
  const tab = loraTabs.some((item) => item.value === picker.tab) ? picker.tab : "all";
  const listed =
    tab === "favourites" ? available.filter((file) => ratings[file] === "up") : available;
  const families = [...new Set(listed.flatMap(familiesOf).map(loraFamilyId))].sort((a, b) =>
    modelFamilyLabel(a).localeCompare(modelFamilyLabel(b)),
  );
  // The profile's family until another is chosen; All Families when no LoRA lists it.
  const ownFamily = loraFamilyId(profile?.family || "");
  const family = picker.family ?? (families.includes(ownFamily) ? ownFamily : "all");
  const terms = picker.query.trim().toLowerCase();
  const shown = listed
    .filter(
      (file) =>
        (family === "all" || fitsFamily(familiesOf(file), family)) &&
        (!terms ||
          [title(file), file, ...(metadata[file]?.triggers || [])]
            .join(" ")
            .toLowerCase()
            .includes(terms)),
    )
    .sort(
      picker.loraSort === "rating"
        ? byRating(ratings, title)
        : (a, b) => (picker.loraSort === "name-asc" ? 1 : -1) * title(a).localeCompare(title(b)),
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
              strength: defaultStrength(metadata[file]),
              enabled: true,
              triggers: true,
            },
          ],
    );
  const empty =
    terms || family !== "all"
      ? "No Matches"
      : tab === "favourites"
        ? "No Starred LoRAs"
        : "No LoRAs";
  // Loading and empty states take the scroll pane's place, centred in its space.
  const state = info.isPending ? (
    <LoadingState fill label="Loading LoRAs" />
  ) : info.error ? (
    <Alert color="red">{info.error.message}</Alert>
  ) : (
    !shown.length && <EmptyState fill>{empty}</EmptyState>
  );
  const choices = shown.length > 0 && (
    // A list on every breakpoint, so names, families and types scan down one column; clicking a
    // row adds or removes its LoRA, and the thumbs beside it rate without toggling it.
    <PickerGrid label="LoRA Choices" rows>
      {shown.map((file) => (
        <PickerTile
          key={file}
          label={title(file)}
          title={title(file)}
          detail={
            [
              familiesOf(file)
                .map((key) => modelFamilyLabel(key))
                .join(", "),
              typeNames[typeOf(file)] || typeOf(file),
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          image={previews.data?.previews[file]}
          placeholder={icons.loras}
          selected={selected.has(file)}
          row
          onToggle={() => toggle(file)}
          action={<LoraThumbs file={file} title={title(file)} />}
        />
      ))}
    </PickerGrid>
  );
  const header = (
    <PickerHeader
      label="LoRAs"
      tabs={[[...loraTabs]]}
      tab={tab}
      onTabChange={picker.setTab}
      query={picker.query}
      onQueryChange={picker.setQuery}
      actions={
        <>
          <Select
            aria-label="Family"
            size="sm"
            radius="xl"
            w="10rem"
            data={[
              { value: "all", label: "All Families" },
              ...families.map((value) => ({ value, label: modelFamilyLabel(value) })),
            ]}
            value={family}
            onChange={(value) => value && picker.setFamily(value)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            data-mantine-stop-propagation
          />
          <SortMenu labels={loraSortLabels} value={picker.loraSort} onChange={picker.setLoraSort} />
        </>
      }
    />
  );
  return (
    <div className={classes.choices}>
      {header}
      {state ? (
        <Stack flex={1} mih={0}>
          {state}
        </Stack>
      ) : (
        <ScrollArea flex={1}>{choices}</ScrollArea>
      )}
    </div>
  );
}

/** A LoRA as the server stores it, so a draft and a saved preset compare equal. */
const storedLora = (lora: Lora) => ({
  name: lora.name,
  enabled: lora.enabled !== false,
  strength: Number(lora.strength),
  triggers: Array.isArray(lora.triggers) ? lora.triggers : lora.triggers !== false,
});
const sameLoras = (a: Lora[], b: Lora[]) =>
  JSON.stringify(a.map(storedLora)) === JSON.stringify(b.map(storedLora));
const loraCount = (count: number) => `${count} ${count === 1 ? "LoRA" : "LoRAs"}`;

/**
 * The draft with the presets holding LoRAs for its family: `current` is the preset whose LoRAs it
 * matches, else the one it last loaded or saved, which it now differs from (`edited`).
 */
function useStackDraft({ value, onChange, picker }: LoraPickerProps) {
  const context = useGeneration();
  const draft = useLoraDraft({ value, onChange });
  const presets = usePresets();
  const family = draft.profile?.family || "";
  const familyOf = (preset: Preset) =>
    preset.family ??
    context.profiles.find((profile) => isProfile(profile, preset.input.profileId))?.family;
  const records = presets.records
    .filter((preset) => preset.input.loras?.length && familyOf(preset) === family)
    .map((preset) => ({ ...preset, detail: loraCount(preset.input.loras.length) }));
  const loras = draft.input.loras;
  const loaded = records.find((preset) => preset.id === picker.presetId);
  const matched = !loras.length
    ? undefined
    : loaded && sameLoras(loaded.input.loras, loras)
      ? loaded
      : records.find((preset) => sameLoras(preset.input.loras, loras));
  const current = matched || (loras.length ? loaded : undefined);
  return { ...draft, presets, records, family, current, edited: !!current && !matched };
}

/**
 * The stack's Clear and Save Preset: beside its heading, or in the phone sheet's footer. Save
 * Preset updates the current preset's LoRAs, or names a new preset of only LoRAs.
 */
function StackActions(props: LoraPickerProps) {
  const { input, update, presets, current, edited } = useStackDraft(props);
  return (
    <>
      <Button
        size="compact-sm"
        variant="subtle"
        aria-label="Clear LoRAs"
        disabled={!input.loras.length}
        onClick={() => update([])}
      >
        Clear
      </Button>
      <SaveButton
        noun="Preset"
        naming={props.picker.naming}
        current={current}
        edited={edited}
        disabled={!input.loras.length || !presets.isSuccess}
        onUpdate={(preset) => presets.update(preset, { ...preset.input, loras: input.loras })}
      />
    </>
  );
}

/** The stack's preset: its name, the presets with LoRAs for this family, and their edits. */
function StackPreset(props: LoraPickerProps) {
  const { picker } = props;
  const { input, update, presets, records, family, current, edited } = useStackDraft(props);
  const load = (preset: Preset) => {
    picker.setPresetId(preset.id);
    update(preset.input.loras.map((lora) => ({ ...lora })));
  };
  return (
    <SavedName
      noun="Preset"
      naming={picker.naming}
      records={records}
      current={current}
      edited={edited}
      canSave={input.loras.length > 0}
      // Only LoRAs no preset holds are lost by loading another, so only those ask first.
      replaces={(preset) =>
        input.loras.length && (!current || edited)
          ? `Replace the current LoRAs with “${preset.title}”?`
          : undefined
      }
      onLoad={load}
      onSave={(title) =>
        presets
          .save({
            title,
            input: { loras: input.loras } as GenerationInput,
            parts: ["loras"],
            family,
          })
          .then((preset) => picker.setPresetId(preset.id))
      }
      onRename={presets.rename}
      onDelete={presets.remove}
    />
  );
}

/** The stack's name, then the chosen LoRAs in order under their heading. */
function LoraStack(props: LoraPickerProps) {
  const phone = usePhone();
  const { input, profile, update, metadata, title, compatible, records } = useStackDraft(props);
  const enabledCount = input.loras.filter((lora) => lora.enabled !== false).length;
  return (
    <>
      <PopupHeading
        title="Stack"
        detail={
          !!profile?.maxLoras && (
            <Text size="xs" c={enabledCount > profile.maxLoras ? "yellow" : "dimmed"}>
              {enabledCount} of {profile.maxLoras} Enabled
            </Text>
          )
        }
        actions={!phone && <StackActions {...props} />}
      />
      {(!!input.loras.length || !!records.length) && <StackPreset {...props} />}
      {/* With nothing chosen, the empty state centres in the pane. */}
      {!input.loras.length ? (
        <EmptyState fill>Choose LoRAs or a preset.</EmptyState>
      ) : (
        <ScrollArea className={classes.stack}>
          <Stack gap="xs">
            {!!profile?.maxLoras && enabledCount > profile.maxLoras && (
              <Text size="xs" c="yellow">
                This profile takes up to {profile.maxLoras} enabled LoRAs. Disable or remove the
                extras.
              </Text>
            )}
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
          </Stack>
        </ScrollArea>
      )}
    </>
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
  const range = info?.strengthRange;
  const step = range?.step ?? 0.05;
  // The catalogue's published range bounds the control; without one, 0 to 2.
  const min = range?.min ?? 0;
  const max = range?.max ?? 2;
  const enabled = lora.enabled !== false;
  // The trigger words switched on lead the prompt when the run is sent (backend/lora/prompts.js).
  const triggers = info?.triggers || [];
  const chosenTriggers =
    lora.triggers === false
      ? []
      : Array.isArray(lora.triggers)
        ? triggers.filter((word) => (lora.triggers as string[]).includes(word))
        : triggers;
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
          <icons.clear size={16} />
        </ActionIcon>
      </Group>
      <Stack gap={6} className={classes.details}>
        <StrengthControl
          label={`${title} Strength`}
          value={lora.strength}
          min={min}
          max={max}
          step={step}
          mark={info?.recommendedStrength ?? range?.default}
          onChange={(strength) => onChange({ strength })}
        />
        {range && (
          <Text size="xs" c="dimmed">
            Suggested {range.min} to {range.max}
            {range.default !== undefined && `, default ${range.default}`}
          </Text>
        )}
        {!compatible && (
          <Text size="xs" c="yellow">
            This profile can't use this LoRA. Disable or remove it.
          </Text>
        )}
        {!!triggers.length && (
          <Chip.Group
            multiple
            value={chosenTriggers}
            // Kept in the catalogue's order; all on is the default, none on is off.
            onChange={(words) => {
              const next = triggers.filter((word) => words.includes(word));
              onChange({
                triggers: next.length === triggers.length ? true : next.length ? next : false,
              });
            }}
          >
            <Group gap={6} role="group" aria-label={`${title} Trigger Words`}>
              <Text size="xs" c="dimmed">
                Trigger Words
              </Text>
              {triggers.map((word) => (
                <Chip key={word} value={word} size="xs" variant="light">
                  {word}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
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
