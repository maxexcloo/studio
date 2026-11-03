import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Divider,
  Group,
  Input,
  MultiSelect,
  Scroller,
  SegmentedControl,
  Stack,
  Tooltip,
} from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { icons } from "../../ui/icons";
import { api } from "../../api";
import { usePhone } from "../../ui/usePhone";
import type { MediaKind, Profile } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { chipProps, iconChipProps } from "../generation/chip";
import { loraInfoQuery, loraTitle } from "../generation/LoraPicker";
import { profileName, shownProfileName } from "../generation/payload";
import { profileNameParts } from "../../../../shared/profiles";
import classes from "./GalleryFilters.module.css";

export interface GalleryFilterOption {
  value: string;
  label: string;
  description?: string;
  /** Every recorded value the option stands for, when one clean name covers several. */
  keys?: string[];
}
const keysOf = (option: GalleryFilterOption) => option.keys || [option.value];

const facets = ["model", "lora", "size", "aspect", "chat"] as const;
type Facet = (typeof facets)[number];
export type GalleryDate = "" | "day" | "week" | "month" | "year";
const dates: { value: GalleryDate; label: string; chip: string; days: number }[] = [
  { value: "", label: "Any", chip: "", days: 0 },
  { value: "day", label: "Today", chip: "Today", days: 0 },
  { value: "week", label: "Week", chip: "Past Week", days: 7 },
  { value: "month", label: "Month", chip: "Past Month", days: 30 },
  { value: "year", label: "Year", chip: "Past Year", days: 365 },
];

/** Every gallery filter: the facets (any value matches), a date range, Starred and Uploads. */
export interface GalleryFilterValues extends Record<Facet, string[]> {
  date: GalleryDate;
  starred: boolean;
  /** Uploaded images instead of generations: the gallery leaves uploads out until this is on. */
  uploads: boolean;
}
export const emptyGalleryFilters: GalleryFilterValues = {
  model: [],
  lora: [],
  size: [],
  aspect: [],
  chat: [],
  date: "",
  starred: false,
  uploads: false,
};

/** The gallery request's filter parameters. */
export function appendGalleryFilters(params: URLSearchParams, filters: GalleryFilterValues) {
  for (const key of facets) for (const value of filters[key]) params.append(key, value);
  params.set("favorites", filters.starred ? "1" : "0");
  params.set("uploads", filters.uploads ? "1" : "0");
  const date = dates.find((option) => option.value === filters.date);
  if (date?.value) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - date.days);
    params.set("since", since.toISOString());
  }
  return params;
}

export const galleryFacetsQuery = (kind?: MediaKind) =>
  queryOptions({
    queryKey: ["gallery-filters", kind || ""],
    queryFn: () =>
      api<{
        models: string[];
        loras: string[];
        sizes: GalleryFilterOption[];
        aspects: GalleryFilterOption[];
        chats: GalleryFilterOption[];
      }>(`/api/gallery/filters?type=${kind || ""}`),
  });

/**
 * A recorded model no profile names (a file or a removed profile's id), read as words without its
 * folder, extension, backend or quantisation: "flux1-dev-fp8_e4m3fn.safetensors" reads "Flux1 Dev".
 */
function modelKeyName(key: string) {
  const words = (
    key
      .replace(/^custom:/, "")
      .split(/[\\/]/)
      .pop() || key
  )
    .replace(/\.(safetensors|gguf|ckpt|pth?|bin|sft)$/i, "")
    .split(/[-_\s]+/)
    .filter(
      (word) =>
        word &&
        !/^(comfyui|radiance|bf16|fp(4|8|16|32)|nvfp4|mxfp4|e4m3fn|e5m2|scaled|gguf|nf4|int[48]|q\d(_k)?(_[a-z0-9]+)?)$/i.test(
          word,
        ),
    );
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") || key;
}

/** One option per clean name, standing for every recorded value with that name, A–Z. */
function byName(keys: string[], name: (key: string) => string): GalleryFilterOption[] {
  const named = new Map<string, string[]>();
  for (const key of keys) named.set(name(key), [...(named.get(name(key)) || []), key]);
  return [...named]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, keys]) => ({ value: label, label, keys }));
}

/**
 * Each facet's options with readable labels, selected values included. Models and LoRAs show the
 * names the composer does, one option per name.
 */
function useFacetOptions(kind: MediaKind | undefined, value: GalleryFilterValues) {
  const { profiles } = useGenerationActions();
  const facets = useQuery(galleryFacetsQuery(kind));
  const loraInfo = useQuery(loraInfoQuery);
  // A file takes the name its profiles share ("Flux Dev" from "Flux Dev · Fast" and "Flux Dev ·
  // Quality"), else their shared model label.
  const loaders = new Map<string, Profile[]>();
  for (const profile of profiles)
    for (const file of new Set([profile.model, profile.baseModel]))
      if (file) loaders.set(file, [...(loaders.get(file) || []), profile]);
  const sharedName = (using: Profile[]) => {
    const [first, ...rest] = using.map((profile) =>
      profileNameParts(profile.displayName || profile.label),
    );
    let length = 0;
    while (length < first.length && rest.every((parts) => parts[length] === first[length]))
      length++;
    return first.slice(0, length).join(" · ");
  };
  const modelNames = new Map(
    [...loaders].map(([file, using]) => {
      const labels = new Set(using.map((profile) => profile.recipe?.modelLabel));
      const label = labels.size === 1 ? [...labels][0] : undefined;
      return [file, sharedName(using) || (label && shownProfileName(label)) || modelKeyName(file)];
    }),
  );
  for (const profile of profiles)
    for (const id of [profile.id, ...(profile.aliases || [])])
      modelNames.set(id, profileName(profile));
  const keys = (key: "model" | "lora") => [
    ...new Set([
      ...(key === "model" ? facets.data?.models || [] : facets.data?.loras || []),
      ...value[key],
    ]),
  ];
  return {
    facets,
    options: {
      model: byName(keys("model"), (key) => modelNames.get(key) || modelKeyName(key)),
      lora: byName(keys("lora"), (key) => loraTitle(loraInfo.data?.loras[key], key)),
      size: facets.data?.sizes || [],
      aspect: facets.data?.aspects || [],
      chat: facets.data?.chats || [],
    } satisfies Record<Facet, GalleryFilterOption[]>,
  };
}

interface FilterProps {
  kind?: MediaKind;
  value: GalleryFilterValues;
  onChange: (value: GalleryFilterValues) => void;
}

/** The active filters as removable chips, one per value, plus any `extra` view choices. */
export function useActiveFilters(
  { kind, value, onChange }: FilterProps,
  extra: { key: string; label: string; remove: () => void }[] = [],
) {
  const { options } = useFacetOptions(kind, value);
  const date = dates.find((option) => option.value === value.date)?.chip;
  return [
    ...(value.starred
      ? [{ key: "starred", label: "Starred", remove: () => onChange({ ...value, starred: false }) }]
      : []),
    ...(value.uploads
      ? [{ key: "uploads", label: "Uploads", remove: () => onChange({ ...value, uploads: false }) }]
      : []),
    ...(date ? [{ key: "date", label: date, remove: () => onChange({ ...value, date: "" }) }] : []),
    ...extra,
    ...facets.flatMap((facet) => {
      const chosen = options[facet].filter((option) =>
        keysOf(option).some((key) => value[facet].includes(key)),
      );
      const named = new Set(chosen.flatMap(keysOf));
      return [
        ...chosen,
        ...value[facet].filter((key) => !named.has(key)).map((key) => ({ value: key, label: key })),
      ].map((option) => ({
        key: `${facet}:${option.value}`,
        label: option.label,
        remove: () =>
          onChange({
            ...value,
            [facet]: value[facet].filter((key) => !keysOf(option).includes(key)),
          }),
      }));
    }),
  ];
}

/**
 * Every image list's toolbar shares these parts: the active filters as removable chips with
 * Clear All, and one Filter ▾ chip that opens the filters.
 */
export function FilterChips({
  chips,
  onClear,
}: {
  chips: { key: string; label: string; remove: () => void }[];
  onClear: () => void;
}) {
  return (
    <Scroller
      className={classes.chips}
      edgeGradientColor="var(--mantine-color-body)"
      controlSize={28}
    >
      <Group gap={6} wrap="nowrap" py={4} role="group" aria-label="Active Filters">
        {chips.map((chip) => (
          <Button
            key={chip.key}
            {...chipProps}
            variant="light"
            aria-label={`Remove ${chip.label} Filter`}
            rightSection={<X size={14} />}
            onClick={chip.remove}
          >
            {chip.label}
          </Button>
        ))}
        {chips.length > 1 && (
          <Button
            {...chipProps}

            variant="subtle"
            color="gray"
            onClick={onClear}
          >
            Clear All
          </Button>
        )}
      </Group>
    </Scroller>
  );
}

export function FilterButton({
  label,
  count,
  opened,
  onClick,
  ref,
}: {
  label: string;
  count: number;
  opened: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const phone = usePhone();
  return (
    <Tooltip label={label} disabled={!phone || opened}>
      <Button
        {...(phone ? iconChipProps : chipProps)}
        ref={ref}
        aria-label={label}
        aria-expanded={opened}
        variant={count || opened ? "light" : "default"}
        leftSection={phone ? undefined : <icons.filter size={15} />}
        rightSection={phone ? undefined : <ChevronDown size={14} />}
        pos="relative"
        style={{ overflow: "visible" }}
        onClick={onClick}
      >
        {phone ? <icons.filter size={16} /> : "Filter"}
        {count > 0 && (
          <Badge size="xs" circle variant="filled" pos="absolute" top={-4} right={-4} aria-hidden>
            {count}
          </Badge>
        )}
      </Button>
    </Tooltip>
  );
}

/**
 * The filters, shared by the gallery's Filter popup and the reference picker: the gallery's `view`
 * (Grid or Runs) on its own row, then Show (All, Starred or Uploads, one at a time), the view's
 * own `toggles` (such as All Versions), the date and each facet. Choices apply at once.
 */
export function GalleryFilterPanel({
  kind,
  value,
  onChange,
  view,
  toggles,
}: FilterProps & { view?: ReactNode; toggles?: ReactNode }) {
  const { facets, options } = useFacetOptions(kind, value);
  const show = value.uploads ? "uploads" : value.starred ? "starred" : "all";
  // A clean name stands for all its recorded values; typing any part of it finds it.
  const many = (key: "model" | "lora" | "chat", label: string) => (
    <MultiSelect
      size="sm"
      label={label}
      placeholder={value[key].length ? undefined : "Any"}
      data={options[key]}
      value={options[key]
        .filter((option) => keysOf(option).some((item) => value[key].includes(item)))
        .map((option) => option.value)}
      onChange={(next) =>
        onChange({
          ...value,
          // In the order they were picked.
          [key]: next.flatMap((picked) =>
            keysOf(options[key].find((option) => option.value === picked)!),
          ),
        })
      }
      searchable
      clearable
      nothingFoundMessage="No Matches"
      rightSection={value[key].length ? undefined : <ChevronDown size={14} />}
      rightSectionPointerEvents="none"
      comboboxProps={{ withinPortal: false }}
    />
  );
  const choices = (key: "size" | "aspect", label: string) => (
    <Input.Wrapper label={label}>
      <Group gap={6} mt={4}>
        {options[key].map((option) => {
          const on = value[key].includes(option.value);
          return (
            <Button
              key={option.value}
              {...chipProps}
              aria-pressed={on}
              title={option.description}
              variant={on ? "light" : "default"}
              onClick={() =>
                onChange({
                  ...value,
                  [key]: on
                    ? value[key].filter((item) => item !== option.value)
                    : [...value[key], option.value],
                })
              }
            >
              {option.label}
            </Button>
          );
        })}
      </Group>
    </Input.Wrapper>
  );
  return (
    <Stack gap="sm">
      {facets.error && (
        <Button
          {...chipProps}
          color="red"
          variant="light"
          leftSection={<icons.retry size={15} />}
          loading={facets.isFetching}
          onClick={() => void facets.refetch()}
        >
          Couldn’t Load Filters
        </Button>
      )}
      {view && <Input.Wrapper label="View">{view}</Input.Wrapper>}
      {/* One of these at a time, so a single choice rather than on/off chips. */}
      <Input.Wrapper label="Show">
        <SegmentedControl
          aria-label="Show"
          fullWidth
          size="xs"
          mt={4}
          value={show}
          onChange={(next) =>
            onChange({ ...value, starred: next === "starred", uploads: next === "uploads" })
          }
          data={[
            { value: "all", label: "All" },
            { value: "starred", label: "Starred" },
            { value: "uploads", label: "Uploads" },
          ]}
        />
      </Input.Wrapper>
      {toggles}
      <Divider />
      <Input.Wrapper label="Date">
        <SegmentedControl
          aria-label="Date"
          fullWidth
          size="xs"
          mt={4}
          value={value.date}
          onChange={(date) => onChange({ ...value, date: date as GalleryDate })}
          data={dates.map(({ value, label }) => ({ value, label }))}
        />
      </Input.Wrapper>
      <Divider />
      {many("model", "Models")}
      {many("lora", "LoRAs")}
      {(options.size.length > 0 || options.aspect.length > 0) && <Divider />}
      {options.size.length > 0 && choices("size", "Size")}
      {options.aspect.length > 0 && choices("aspect", "Aspect Ratio")}
    </Stack>
  );
}
