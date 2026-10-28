import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Group,
  Input,
  MultiSelect,
  Scroller,
  SegmentedControl,
  Stack,
  Tooltip,
} from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChevronDown, RotateCw, SlidersHorizontal, Star, Upload, X } from "lucide-react";
import { api } from "../../api";
import { usePhone } from "../../ui/usePhone";
import type { MediaKind } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { chipProps, iconChipProps } from "../generation/chip";
import { loraInfoQuery } from "../generation/LoraPicker";
import classes from "./GalleryFilters.module.css";

export interface GalleryFilterOption {
  value: string;
  label: string;
  description?: string;
}

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

/** Each facet's options with readable labels, selected values included. */
function useFacetOptions(kind: MediaKind | undefined, value: GalleryFilterValues) {
  const { profiles } = useGenerationActions();
  const facets = useQuery(galleryFacetsQuery(kind));
  const loraInfo = useQuery(loraInfoQuery);
  const modelLabels = new Map(
    profiles.flatMap((profile) =>
      [profile.model, profile.baseModel, profile.id]
        .filter((item): item is string => Boolean(item))
        .map((item) => [item, profile.recipe?.modelLabel || profile.displayName || profile.label]),
    ),
  );
  const options = (key: "model" | "lora") =>
    [
      ...new Set([
        ...(key === "model" ? facets.data?.models || [] : facets.data?.loras || []),
        ...value[key],
      ]),
    ].map((item) => ({
      value: item,
      label:
        key === "model" ? modelLabels.get(item) || item : loraInfo.data?.loras[item]?.title || item,
    }));
  return {
    facets,
    options: {
      model: options("model"),
      lora: options("lora"),
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
    ...facets.flatMap((facet) =>
      value[facet].map((selected) => ({
        key: `${facet}:${selected}`,
        label: options[facet].find((option) => option.value === selected)?.label || selected,
        remove: () =>
          onChange({ ...value, [facet]: value[facet].filter((item) => item !== selected) }),
      })),
    ),
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
        leftSection={phone ? undefined : <SlidersHorizontal size={15} />}
        rightSection={phone ? undefined : <ChevronDown size={14} />}
        pos="relative"
        style={{ overflow: "visible" }}
        onClick={onClick}
      >
        {phone ? <SlidersHorizontal size={16} /> : "Filter"}
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
 * The filters, shared by the gallery's Filter popup and the reference picker: toggles first
 * (with `children`, such as the gallery's view choices), then the date and each facet. Choices
 * apply at once.
 */
export function GalleryFilterPanel({
  kind,
  value,
  onChange,
  children,
}: FilterProps & { children?: ReactNode }) {
  const { facets, options } = useFacetOptions(kind, value);
  const toggle = (key: "starred" | "uploads", label: string, icon: ReactNode) => (
    <Button
      {...chipProps}
      aria-label={label}
      aria-pressed={value[key]}
      variant={value[key] ? "light" : "default"}
      leftSection={icon}
      onClick={() => onChange({ ...value, [key]: !value[key] })}
    >
      {label}
    </Button>
  );
  const many = (key: "model" | "lora" | "chat", label: string) => (
    <MultiSelect
      size="sm"
      label={label}
      placeholder={value[key].length ? undefined : "Any"}
      data={options[key]}
      value={value[key]}
      onChange={(next) => onChange({ ...value, [key]: next })}
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
          leftSection={<RotateCw size={15} />}
          loading={facets.isFetching}
          onClick={() => void facets.refetch()}
        >
          Couldn’t Load Filters
        </Button>
      )}
      {children}
      <Group gap={6}>
        {toggle(
          "starred",
          "Starred",
          <Star size={15} fill={value.starred ? "currentColor" : "none"} />,
        )}
        {toggle("uploads", "Uploads", <Upload size={15} />)}
      </Group>
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
      {many("model", "Models")}
      {many("lora", "LoRAs")}
      {options.size.length > 0 && choices("size", "Size")}
      {options.aspect.length > 0 && choices("aspect", "Aspect Ratio")}
      {options.chat.length > 0 && many("chat", "Chats")}
    </Stack>
  );
}
