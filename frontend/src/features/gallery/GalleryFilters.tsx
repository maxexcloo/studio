import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Badge, Button, Group, Scroller, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  Layers,
  MessageCircle,
  Ratio,
  RotateCw,
  Ruler,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import { api } from "../../api";
import { SearchInput } from "../../ui/SearchInput";
import type { MediaKind } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
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
 * Normal, search and filter modes share one toolbar row. Search expands into a full-width input;
 * filters expand into a row of labelled facets that apply as they change.
 */
export function GalleryFilterToolbar({
  query,
  onQueryChange,
  filtersInitiallyOpen = false,
  leading,
  actions,
  ...props
}: GalleryFiltersProps & {
  query: string;
  onQueryChange: (value: string) => void;
  filtersInitiallyOpen?: boolean;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  const [mode, setMode] = useState<"normal" | "search" | "filters">(
    filtersInitiallyOpen ? "filters" : "normal",
  );
  const searchOpen = mode === "search";
  const selectedCount =
    Number(props.starred) +
    Object.values(props.value).reduce((count, values) => count + values.length, 0);
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
    if (searchOpen) searchInput.current?.focus();
    else setMode("search");
  }
  useHotkeys([
    ["/", openSearch, { preventDefault: false }],
    ["mod+f", openSearch, { preventDefault: false }],
  ]);
  function dismiss() {
    setMode("normal");
    const trigger = mode === "filters" ? filtersButton : searchButton;
    requestAnimationFrame(() => trigger.current?.focus());
  }
  if (mode === "search")
    return (
      <Group key="search" ref={toolbar} mih={44} w="100%" className={classes.mode}>
        <SearchInput
          ref={searchInput}
          aria-label="Search Gallery"
          placeholder="Search your generations…"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onClear={() => onQueryChange("")}
          onClose={dismiss}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              dismiss();
            }
          }}
          w="100%"
        />
      </Group>
    );
  if (mode === "filters")
    return (
      <Group key="filters" ref={toolbar} gap={4} mih={44} wrap="nowrap" className={classes.mode}>
        <Tooltip label="Close Filters">
          <ActionIcon aria-label="Close Filters" variant="subtle" color="gray" onClick={dismiss}>
            <ArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <GalleryFilters {...props} />
      </Group>
    );
  return (
    <Group key="normal" ref={toolbar} gap="xs" mih={44} wrap="nowrap" className={classes.mode}>
      <Tooltip label="Search Gallery">
        <ActionIcon
          ref={searchButton}
          aria-label="Search Gallery"
          aria-expanded={false}
          onClick={() => setMode("search")}
          variant={query ? "light" : "subtle"}
          color={query ? undefined : "gray"}
        >
          <Search size={19} />
        </ActionIcon>
      </Tooltip>
      {leading}
      <Group gap="xs" ml="auto" wrap="nowrap">
        {selectedCount > 0 && (
          <Tooltip label="Clear Filters">
            <ActionIcon
              aria-label="Clear Filters"
              variant="subtle"
              color="gray"
              onClick={() => {
                props.onStarredChange(false);
                props.onChange(emptyGalleryFilters);
              }}
            >
              <X size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Gallery Filters">
          <ActionIcon
            ref={filtersButton}
            aria-label="Gallery Filters"
            aria-expanded={false}
            variant={selectedCount ? "light" : "subtle"}
            color={selectedCount ? undefined : "gray"}
            pos="relative"
            onClick={() => setMode("filters")}
          >
            <SlidersHorizontal size={19} />
            {selectedCount > 0 && (
              <Badge size="xs" circle pos="absolute" top={0} right={0} aria-hidden>
                {selectedCount}
              </Badge>
            )}
          </ActionIcon>
        </Tooltip>
        {actions}
      </Group>
    </Group>
  );
}

function GalleryFilters({
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
                color="red"
                variant="light"
                size="compact-md"
                radius="xl"
                leftSection={<RotateCw size={15} />}
                loading={facets.isFetching}
                onClick={() => void facets.refetch()}
              >
                Couldn’t Load Filters
              </Button>
            </Tooltip>
          )}
          <Button
            aria-label="Starred"
            aria-pressed={starred}
            variant={starred ? "light" : "default"}
            size="compact-md"
            radius="xl"
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
          aria-label="Clear Filters"
          variant="subtle"
          color="gray"
          size="compact-md"
          radius="xl"
          leftSection={<X size={15} />}
          className={classes.clear}
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
