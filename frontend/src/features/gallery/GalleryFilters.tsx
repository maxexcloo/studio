import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  Layers,
  Ratio,
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

export interface GalleryFilterValues {
  model: string[];
  lora: string[];
  size: string[];
  aspect: string[];
}
export const emptyGalleryFilters: GalleryFilterValues = {
  model: [],
  lora: [],
  size: [],
  aspect: [],
};
export const hasGalleryFilters = (filters: GalleryFilterValues) =>
  Object.values(filters).some((values) => values.length > 0);
export function appendGalleryFilters(params: URLSearchParams, filters: GalleryFilterValues) {
  for (const [key, values] of Object.entries(filters))
    for (const value of values) params.append(key, value);
  return params;
}
interface GalleryFacets {
  models: string[];
  loras: string[];
  sizes: GalleryFilterOption[];
  aspects: GalleryFilterOption[];
}

/** The gallery and reference picker share facets, labels and selection behaviour. */
interface GalleryFiltersProps {
  kind?: MediaKind;
  value: GalleryFilterValues;
  onChange: (value: GalleryFilterValues) => void;
  starred: boolean;
  onStarredChange: (value: boolean) => void;
  withinPortal?: boolean;
}
export function GalleryFilterToolbar({
  query,
  onQueryChange,
  filtersInitiallyOpen = false,
  actions,
  ...props
}: GalleryFiltersProps & {
  query: string;
  onQueryChange: (value: string) => void;
  filtersInitiallyOpen?: boolean;
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
      <Group ref={toolbar} mih={44} w="100%">
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
      <Group ref={toolbar} gap={4} mih={44} wrap="nowrap">
        <Tooltip label="Close Filters">
          <ActionIcon
            aria-label="Close Filters"
            variant="subtle"
            color="gray"
            size={36}
            onClick={dismiss}
          >
            <ArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <GalleryFilters {...props} />
      </Group>
    );
  return (
    <Group ref={toolbar} gap="xs" mih={44} wrap="nowrap">
      <Tooltip label="Search Gallery">
        <ActionIcon
          ref={searchButton}
          aria-label="Search Gallery"
          aria-expanded={false}
          onClick={() => setMode("search")}
          variant={query ? "light" : "subtle"}
          color={query ? undefined : "gray"}
          size={36}
        >
          <Search size={19} />
        </ActionIcon>
      </Tooltip>
      <Group gap="xs" ml="auto" wrap="nowrap">
        <Tooltip label="Gallery Filters">
          <ActionIcon
            ref={filtersButton}
            aria-label="Gallery Filters"
            aria-expanded={false}
            variant={selectedCount ? "light" : "subtle"}
            color={selectedCount ? undefined : "gray"}
            size={36}
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
  const facets = useQuery({
    queryKey: ["gallery-filters", kind || ""],
    queryFn: () => api<GalleryFacets>(`/api/gallery/filters?type=${kind || ""}`),
    refetchInterval: 3000,
  });
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
  return (
    <>
      <Tooltip label="Only Starred">
        <ActionIcon
          aria-label="Starred"
          aria-pressed={starred}
          variant={starred ? "light" : "subtle"}
          color={starred ? undefined : "gray"}
          size={36}
          onClick={() => onStarredChange(!starred)}
        >
          <Star size={19} fill={starred ? "currentColor" : "none"} />
        </ActionIcon>
      </Tooltip>
      <GalleryFilterPicker
        label="Models"
        withinPortal={withinPortal}
        icon={Boxes}
        options={options("model")}
        value={value.model}
        onChange={(model) => onChange({ ...value, model })}
        searchable
      />
      <GalleryFilterPicker
        label="LoRAs"
        withinPortal={withinPortal}
        icon={Layers}
        options={options("lora")}
        value={value.lora}
        onChange={(lora) => onChange({ ...value, lora })}
        searchable
      />
      <GalleryFilterPicker
        label="Size"
        withinPortal={withinPortal}
        icon={Ruler}
        options={facets.data?.sizes || []}
        value={value.size}
        onChange={(size) => onChange({ ...value, size })}
      />
      <GalleryFilterPicker
        label="Aspect Ratio"
        withinPortal={withinPortal}
        icon={Ratio}
        options={facets.data?.aspects || []}
        value={value.aspect}
        onChange={(aspect) => onChange({ ...value, aspect })}
      />
      {(starred || hasGalleryFilters(value)) && (
        <Tooltip label="Clear Filters">
          <ActionIcon
            aria-label="Clear Filters"
            variant="subtle"
            color="gray"
            size={36}
            ml="auto"
            onClick={() => {
              onStarredChange(false);
              onChange(emptyGalleryFilters);
            }}
          >
            <X size={19} />
          </ActionIcon>
        </Tooltip>
      )}
      {facets.error && (
        <Alert w="100%" color="red" title="Couldn’t Load Gallery Filters">
          {facets.error.message}
          <Button variant="subtle" onClick={() => void facets.refetch()}>
            Try Again
          </Button>
        </Alert>
      )}
    </>
  );
}
