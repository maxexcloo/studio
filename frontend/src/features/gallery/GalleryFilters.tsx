import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Group, Scroller, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Layers,
  MessageCircle,
  Ratio,
  RotateCw,
  Ruler,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { api } from "../../api";
import { SearchInput } from "../../ui/SearchInput";
import { usePhone } from "../../ui/usePhone";
import type { MediaKind } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { chipProps, iconChipProps } from "../generation/chip";
import { loraInfoQuery } from "../generation/LoraPicker";
import { GalleryFilterPicker, type GalleryFilterOption } from "./GalleryFilterPicker";
import classes from "./GalleryFilters.module.css";

export interface GalleryFilterValues {
  model: string[];
  lora: string[];
  size: string[];
  aspect: string[];
  chat: string[];
}
export const emptyGalleryFilters: GalleryFilterValues = {
  model: [],
  lora: [],
  size: [],
  aspect: [],
  chat: [],
};
export const hasGalleryFilters = (filters: GalleryFilterValues) =>
  Object.values(filters).some((values) => values.length > 0);
export function appendGalleryFilters(params: URLSearchParams, filters: GalleryFilterValues) {
  for (const [key, values] of Object.entries(filters))
    for (const value of values) params.append(key, value);
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

/** How many filters are on, Starred included, for a filter action's badge. */
export const galleryFilterCount = (filters: GalleryFilterValues, starred: boolean) =>
  Number(starred) + Object.values(filters).reduce((count, values) => count + values.length, 0);

/** The gallery and reference picker share facets, labels and selection behaviour. */
interface GalleryFiltersProps {
  kind?: MediaKind;
  value: GalleryFilterValues;
  onChange: (value: GalleryFilterValues) => void;
  starred: boolean;
  onStarredChange: (value: boolean) => void;
  withinPortal?: boolean;
}
/**
 * Normal, search and filter modes share one toolbar row. Desktop keeps the search box in the row;
 * phones open it from an icon into the full row. The Filter chip swaps the leading controls for a
 * row of labelled facets that apply as they change; Filter again ends it.
 */
export function GalleryFilterToolbar({
  query,
  onQueryChange,
  leading,
  actions,
  ...props
}: GalleryFiltersProps & {
  query: string;
  onQueryChange: (value: string) => void;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  const phone = usePhone();
  const [mode, setMode] = useState<"normal" | "search" | "filters">("normal");
  const searchOpen = mode === "search";
  // A search set from elsewhere (a caption tag) opens the phone's field so it shows what is
  // filtered; desktop always shows its box.
  useEffect(() => {
    if (query && phone) setMode((current) => (current === "normal" ? "search" : current));
  }, [query, phone]);
  const selectedCount = galleryFilterCount(props.value, props.starred);
  const toolbar = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  function openSearch(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !toolbar.current)
      return;
    const selector =
      '[role="dialog"], [role="alertdialog"], .mantine-Popover-dropdown, .mantine-Combobox-dropdown';
    const owner = toolbar.current.closest(selector);
    const layers = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (layer) => layer.getClientRects().length && !layer.closest("[inert]"),
    );
    if (owner ? !owner.contains(event.target as Node) : layers.length) return;
    event.preventDefault();
    if (phone && !searchOpen) setMode("search");
    else {
      setMode((current) => (current === "filters" ? "normal" : current));
      requestAnimationFrame(() => searchInput.current?.focus());
    }
  }
  useHotkeys([
    ["/", openSearch, { preventDefault: false }],
    ["mod+f", openSearch, { preventDefault: false }],
  ]);
  function dismiss() {
    const trigger = mode === "filters" ? filtersButton : searchButton;
    setMode("normal");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const search = (
    <SearchInput
      ref={searchInput}
      aria-label="Search Gallery"
      placeholder="Search your generations…"
      size="sm"
      radius="xl"
      value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)}
      onClear={() => onQueryChange("")}
      onClose={phone ? dismiss : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (phone) dismiss();
        else event.currentTarget.blur();
      }}
      className={phone ? classes.searchOpen : classes.search}
    />
  );
  if (searchOpen)
    return (
      <Group key="search" ref={toolbar} mih={44} wrap="nowrap" className={classes.mode}>
        {search}
      </Group>
    );
  const filtering = mode === "filters";
  return (
    <Group ref={toolbar} gap="xs" mih={44} wrap="nowrap">
      {filtering ? (
        <Group key="filters" gap={6} wrap="nowrap" className={`${classes.mode} ${classes.lead}`}>
          <GalleryFilters {...props} />
        </Group>
      ) : (
        <Group key="normal" gap="xs" wrap="nowrap" className={`${classes.mode} ${classes.lead}`}>
          {phone ? (
            <Tooltip label="Search Gallery" disabled={phone}>
              <Button
                {...iconChipProps}
                ref={searchButton}
                aria-label="Search Gallery"
                aria-expanded={false}
                variant={query ? "light" : "default"}
                onClick={() => setMode("search")}
              >
                <Search size={16} />
              </Button>
            </Tooltip>
          ) : (
            search
          )}
          {leading}
        </Group>
      )}
      <Group gap="xs" ml="auto" wrap="nowrap">
        <Tooltip label="Gallery Filters" disabled={!phone}>
          <Button
            {...(phone ? iconChipProps : chipProps)}
            ref={filtersButton}
            aria-label="Gallery Filters"
            aria-expanded={filtering}
            variant={selectedCount || filtering ? "light" : "default"}
            leftSection={phone ? undefined : <SlidersHorizontal size={15} />}
            rightSection={
              selectedCount > 0 && !phone ? (
                <Badge size="xs" circle aria-hidden>
                  {selectedCount}
                </Badge>
              ) : undefined
            }
            pos="relative"
            onClick={() => (filtering ? dismiss() : setMode("filters"))}
          >
            {phone ? <SlidersHorizontal size={16} /> : "Filter"}
            {phone && selectedCount > 0 && (
              <Badge
                size="xs"
                circle
                variant="filled"
                pos="absolute"
                top={-2}
                right={-2}
                aria-hidden
              >
                {selectedCount}
              </Badge>
            )}
          </Button>
        </Tooltip>
        {actions}
      </Group>
    </Group>
  );
}

/** The facets as a row, for the gallery toolbar's filter mode and the reference picker. */
export function GalleryFilters({
  kind,
  value,
  onChange,
  starred,
  onStarredChange,
  withinPortal,
}: GalleryFiltersProps) {
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
  const picker = (
    key: keyof GalleryFilterValues,
    label: string,
    icon: typeof Boxes,
    choices: GalleryFilterOption[],
    searchable = false,
  ) => (
    <GalleryFilterPicker
      label={label}
      withinPortal={withinPortal}
      icon={icon}
      options={choices}
      value={value[key]}
      onChange={(next) => onChange({ ...value, [key]: next })}
      searchable={searchable}
    />
  );
  const active = starred || hasGalleryFilters(value);
  return (
    <>
      <Scroller
        className={classes.facets}
        edgeGradientColor="var(--mantine-color-body)"
        controlSize={28}
      >
        <Group gap={6} wrap="nowrap" py={4}>
          {facets.error && (
            <Tooltip label={facets.error.message}>
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
            </Tooltip>
          )}
          <Button
            {...chipProps}
            aria-label="Starred"
            aria-pressed={starred}
            variant={starred ? "light" : "default"}
            leftSection={<Star size={15} fill={starred ? "currentColor" : "none"} />}
            onClick={() => onStarredChange(!starred)}
          >
            Starred
          </Button>
          {picker("model", "Models", Boxes, options("model"), true)}
          {picker("lora", "LoRAs", Layers, options("lora"), true)}
          {picker("size", "Size", Ruler, facets.data?.sizes || [])}
          {picker("aspect", "Aspect Ratio", Ratio, facets.data?.aspects || [])}
          {picker("chat", "Chats", MessageCircle, facets.data?.chats || [], true)}
        </Group>
      </Scroller>
      {active && (
        <Button
          {...chipProps}
          aria-label="Clear Filters"
          variant="subtle"
          color="gray"
          className={`${chipProps.className} ${classes.clear}`}
          onClick={() => {
            onStarredChange(false);
            onChange(emptyGalleryFilters);
          }}
        >
          Clear
        </Button>
      )}
    </>
  );
}
