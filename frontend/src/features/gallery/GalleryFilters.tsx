import {
  Button,
  Divider,
  Group,
  Input,
  MultiSelect,
  Scroller,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { galleryOrigins } from "../../../../shared/gallery-origin";
import { loraName, profileNameParts } from "../../../../shared/profiles";
import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import type { MediaKind, Profile } from "../../types";
import { ChipPopup } from "../../ui/ChipPopup";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { FilterChoices } from "../../ui/SectionToolbar";
import { chipProps } from "../generation/chip";
import { useGenerationActions } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { profileName, shownProfileName } from "../generation/payload";
import type { GalleryReviewRating } from "./queries";

import classes from "./GalleryFilters.module.css";

interface GalleryFilterOption {
  value: string;
  label: string;
  description?: string;
  /** How many items carry it (caption tags). */
  count?: number;
  /** Every recorded value the option stands for, when one clean name covers several. */
  keys?: string[];
}
/** An active filter's chip; one with a `choice` opens it beside its remove button, to change in place. */
export interface FilterChip {
  key: string;
  label: string;
  remove: () => void;
  choice?: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
}
const keysOf = (option: GalleryFilterOption) => option.keys || [option.value];

const facets = ["model", "lora", "size", "aspect", "tag", "origin"] as const;
type Facet = (typeof facets)[number];
type GalleryDate = "" | "day" | "week" | "month" | "year";
/** Every rating menu's choices. All is liked and unrated: disliked results stay hidden. */
export const ratingChoices: { value: GalleryReviewRating; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unrated", label: "Unrated" },
  { value: "liked", label: "Liked" },
  { value: "disliked", label: "Disliked" },
];
/** The date filter's choices, and Review's times; each reaches back from the start of today. */
export const galleryDates: {
  value: Exclude<GalleryDate, "">;
  label: string;
  chip: string;
  days: number;
}[] = [
  { value: "day", label: "Today", chip: "Today", days: 0 },
  { value: "week", label: "Week", chip: "Past Week", days: 7 },
  { value: "month", label: "Month", chip: "Past Month", days: 30 },
  { value: "year", label: "Year", chip: "Past Year", days: 365 },
];

/**
 * Every gallery filter: the facets (any value matches), a date range, a rating,
 * Off-Character and Uploads.
 */
export interface GalleryFilterValues extends Record<Facet, string[]> {
  date: GalleryDate;
  /** Results Face Check found off their character (backend/domain/face-check.ts). */
  offCharacter: boolean;
  /** Limit the results to liked, unrated or disliked items; empty is All. */
  rating: Exclude<GalleryReviewRating, "all"> | "";
  /** Uploaded images instead of generations: the gallery leaves uploads out until this is on. */
  uploads: boolean;
}
export const emptyGalleryFilters: GalleryFilterValues = {
  model: [],
  lora: [],
  size: [],
  aspect: [],
  tag: [],
  origin: [],
  date: "",
  offCharacter: false,
  rating: "",
  uploads: false,
};

/** The gallery request's filter parameters. */
export function appendGalleryFilters(params: URLSearchParams, filters: GalleryFilterValues) {
  for (const key of facets) for (const value of filters[key]) params.append(key, value);
  if (filters.rating === "unrated") params.set("unrated", "1");
  else if (filters.rating) params.set("rating", filters.rating);
  if (filters.offCharacter) params.set("drifted", "1");
  params.set("uploads", filters.uploads ? "1" : "0");
  if (filters.date) params.set("since", dateCutoff(filters.date).toISOString());
  return params;
}

/** When a date choice starts. */
export function dateCutoff(date: Exclude<GalleryDate, "">) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - galleryDates.find((option) => option.value === date)!.days);
  return since;
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
        /** The most used caption tags, with counts. */
        tags: GalleryFilterOption[];
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
        !/^(comfyui|radiance|bf16|fp(4|8|16|32)|iq\d+r|i8|nvfp4|mxfp4|e4m3fn|e5m2|scaled|gguf|nf4|int[48]|q\d(_k)?(_[a-z0-9]+)?)$/i.test(
          word,
        ),
    );
  return titleCase(words.join(" ")) || key;
}

/** One option per clean name, standing for every recorded value with that name, A–Z. */
function byName(keys: string[], name: (key: string) => string): GalleryFilterOption[] {
  const named = new Map<string, string[]>();
  for (const key of keys) named.set(name(key), [...(named.get(name(key)) || []), key]);
  return [...named]
    .sort(([a], [b]) => compareNames(a, b))
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
  for (const profile of profiles) modelNames.set(profile.id, profileName(profile));
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
      lora: byName(keys("lora"), (key) => loraName(key, loraInfo.data?.loras[key])),
      size: [...(facets.data?.sizes || [])].sort((a, b) => compareNames(a.label, b.label)),
      aspect: [...(facets.data?.aspects || [])].sort((a, b) => compareNames(a.label, b.label)),
      tag: facets.data?.tags || [],
      origin: galleryOrigins as GalleryFilterOption[],
    } satisfies Record<Facet, GalleryFilterOption[]>,
  };
}

interface FilterProps {
  kind?: MediaKind;
  value: GalleryFilterValues;
  onChange: (value: GalleryFilterValues) => void;
}

/**
 * The active filters as removable chips, one per value, plus any `extra` view choices. Uploads has
 * none: its own view shows it.
 */
export function useActiveFilters(
  { kind, value, onChange }: FilterProps,
  extra: FilterChip[] = [],
): FilterChip[] {
  const { options } = useFacetOptions(kind, value);
  const date = galleryDates.find((option) => option.value === value.date)?.chip;
  return [
    ...(date ? [{ key: "date", label: date, remove: () => onChange({ ...value, date: "" }) }] : []),
    ...(value.rating
      ? [
          {
            key: value.rating,
            label: ratingChoices.find((choice) => choice.value === value.rating)!.label,
            remove: () => onChange({ ...value, rating: "" }),
          },
        ]
      : []),
    ...(value.offCharacter
      ? [
          {
            key: "off-character",
            label: "Off-Character",
            remove: () => onChange({ ...value, offCharacter: false }),
          },
        ]
      : []),
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
  children,
}: {
  chips: FilterChip[];
  onClear: () => void;
  children?: ReactNode;
}) {
  return (
    <Scroller className={classes.chips} edgeGradientColor="transparent" controlSize={28}>
      <Group gap={6} wrap="nowrap" py={4} role="group" aria-label="Active Filters">
        {chips.map((chip) =>
          chip.choice ? (
            <ChoiceChip key={chip.key} chip={chip} choice={chip.choice} />
          ) : (
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
          ),
        )}
        {children}
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

/** A chip whose popup changes its choice in place; Clear removes it, as its own ✕ does. */
function ChoiceChip({
  chip,
  choice,
}: {
  chip: FilterChip;
  choice: NonNullable<FilterChip["choice"]>;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Button.Group>
      <ChipPopup
        title={choice.label}
        floating
        position="bottom-start"
        opened={opened}
        onOpenedChange={setOpened}
        onClear={chip.remove}
        target={
          <Button
            {...chipProps}
            variant="light"
            aria-expanded={opened}
            rightSection={<ChevronDown size={14} />}
            onClick={() => setOpened(!opened)}
          >
            {chip.label}
          </Button>
        }
      >
        <SegmentedControl
          aria-label={choice.label}
          size="xs"
          value={choice.value}
          onChange={choice.onChange}
          data={choice.options}
        />
      </ChipPopup>
      <Button
        {...chipProps}
        variant="light"
        aria-label={`Remove ${chip.label} Filter`}
        onClick={chip.remove}
      >
        <X size={14} />
      </Button>
    </Button.Group>
  );
}

/** A filter chip that turns on and off with one tap, pressed while on. */
export function FilterToggle({
  label,
  on,
  onToggle,
  title,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <Button
      {...chipProps}
      aria-pressed={on}
      title={title}
      variant={on ? "light" : "default"}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}

/**
 * The Show filters the gallery and reference picker share. Off-Character turns Uploads off and
 * shows images Face Check found off their character.
 */
export function ShowToggles({
  kind,
  value,
  onChange,
  originalsOnly = false,
  onOriginalsOnly,
}: FilterProps & { originalsOnly?: boolean; onOriginalsOnly?: (on: boolean) => void }) {
  return (
    <Input.Wrapper label="Show">
      <Group gap={6} mt={4} role="group" aria-label="Show">
        {galleryOrigins.map(({ value: origin, label }) => (
          <FilterToggle
            key={origin}
            label={label}
            on={value.origin.includes(origin)}
            onToggle={() =>
              onChange({
                ...value,
                origin: value.origin.includes(origin)
                  ? value.origin.filter((item) => item !== origin)
                  : [...value.origin, origin],
              })
            }
          />
        ))}
        {kind !== "video" && (
          <FilterToggle
            label="Off-Character"
            on={value.offCharacter}
            onToggle={() =>
              onChange({ ...value, offCharacter: !value.offCharacter, uploads: false })
            }
          />
        )}
        {onOriginalsOnly && (
          <FilterToggle
            label="Originals Only"
            on={originalsOnly}
            onToggle={() => onOriginalsOnly(!originalsOnly)}
          />
        )}
      </Group>
    </Input.Wrapper>
  );
}

/**
 * The gallery's Filter popup and the reference picker share the Show toggles, date and facets,
 * sorted by name; the picker adds a rating, which turns Uploads off.
 */
export function GalleryFilterPanel({
  kind,
  value,
  onChange,
  toggles,
  rating = false,
}: FilterProps & {
  toggles?: ReactNode;
  /** Offers the rating choices, where no view menu does. */
  rating?: boolean;
}) {
  const { facets, options } = useFacetOptions(kind, value);
  // Tags list by name, each with its count, and keep a chosen tag no longer among them.
  const counts = new Map(options.tag.map((option) => [option.value, option.count]));
  const lists = {
    ...options,
    tag: [
      ...[...options.tag].sort((a, b) => compareNames(a.label, b.label)),
      ...value.tag.filter((tag) => !counts.has(tag)).map((tag) => ({ value: tag, label: tag })),
    ],
  };
  // A clean name stands for all its recorded values; typing any part of it finds it.
  const many = (key: Facet, label: string) => (
    <MultiSelect
      size="sm"
      aria-label={label}
      label={label}
      placeholder={value[key].length ? undefined : "Any"}
      data={lists[key]}
      renderOption={
        key === "tag"
          ? ({ option }) => (
              <Group gap={6} wrap="nowrap">
                {option.label}
                <Text span size="xs" c="dimmed">
                  {counts.get(option.value)}
                </Text>
              </Group>
            )
          : undefined
      }
      value={lists[key]
        .filter((option) => keysOf(option).some((item) => value[key].includes(item)))
        .map((option) => option.value)}
      onChange={(next) =>
        onChange({
          ...value,
          // In the order they were picked.
          [key]: next.flatMap((picked) =>
            keysOf(lists[key].find((option) => option.value === picked)!),
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
  const choices = (key: "aspect" | "size", label: string) => (
    <Input.Wrapper label={label}>
      <Group gap={6} mt={4} role="group" aria-label={label}>
        {options[key].map((option) => {
          const on = value[key].includes(option.value);
          return (
            <FilterToggle
              key={option.value}
              label={option.label}
              title={option.description}
              on={on}
              onToggle={() =>
                onChange({
                  ...value,
                  [key]: on
                    ? value[key].filter((item) => item !== option.value)
                    : [...value[key], option.value],
                })
              }
            />
          );
        })}
      </Group>
    </Input.Wrapper>
  );
  // Sections sort by name; Date keeps its order from Today back.
  const sections: { key: string; node: ReactNode }[] = [];
  if (options.aspect.length > 0)
    sections.push({ key: "Aspect Ratio", node: choices("aspect", "Aspect Ratio") });
  sections.push({
    key: "Date",
    node: (
      <FilterChoices
        label="Date"
        data={galleryDates}
        value={value.date || null}
        onChange={(date) => onChange({ ...value, date: (date ?? "") as GalleryDate })}
      />
    ),
  });
  sections.push({ key: "LoRAs", node: many("lora", "LoRAs") });
  sections.push({ key: "Models", node: many("model", "Models") });
  if (rating)
    sections.push({
      key: "Rating",
      node: (
        <FilterChoices
          label="Rating"
          data={ratingChoices.filter((choice) => choice.value !== "all")}
          value={value.rating || null}
          onChange={(choice) =>
            onChange({
              ...value,
              rating: (choice ?? "") as GalleryFilterValues["rating"],
              uploads: false,
            })
          }
        />
      ),
    });
  if (toggles) sections.push({ key: "Show", node: toggles });
  if (options.size.length > 0) sections.push({ key: "Size", node: choices("size", "Size") });
  if (lists.tag.length > 0) sections.push({ key: "Tags", node: many("tag", "Tags") });
  return (
    <Stack gap="md">
      {facets.error && (
        <Button
          {...chipProps}
          color="red"
          variant="light"
          leftSection={<icons.retry size={15} />}
          disabled={facets.isFetching}
          onClick={() => void facets.refetch()}
        >
          Couldn't Load Filters
        </Button>
      )}
      {sections.flatMap(({ key, node }, index) => [
        ...(index > 0 ? [<Divider key={`${key}-divider`} />] : []),
        <Fragment key={key}>{node}</Fragment>,
      ])}
    </Stack>
  );
}
