import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Group, Slider, Text, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { Search, SquareMinus, SquarePlus } from "lucide-react";
import { SearchInput } from "../../ui/SearchInput";
import { usePhone } from "../../ui/usePhone";
import type { MediaKind } from "../../types";
import { iconChipProps } from "../generation/chip";
import { ChipPopup } from "../generation/Picker";
import {
  FilterButton,
  FilterChips,
  GalleryFilterPanel,
  emptyGalleryFilters,
  useActiveFilters,
  type GalleryFilterValues,
} from "./GalleryFilters";
import { useGalleryColumns } from "./useGalleryLayout";
import classes from "./GalleryFilters.module.css";

/**
 * The gallery's one toolbar row: search, the active filters as removable chips, the result count,
 * the zoom slider (desktop; phones pinch), Filter ▾ and `actions`. Phones open the search from its
 * icon into the full row. Search narrows within the filters; filter changes keep the query.
 */
export function GalleryToolbar({
  kind,
  query,
  onQueryChange,
  value,
  onChange,
  extraChips,
  view,
  count,
  actions,
}: {
  kind: MediaKind;
  query: string;
  onQueryChange: (value: string) => void;
  value: GalleryFilterValues;
  onChange: (value: GalleryFilterValues) => void;
  /** View choices that narrow what shows, such as collapsed versions, as removable chips. */
  extraChips: { key: string; label: string; remove: () => void }[];
  /** The view's own choices, at the top of the Filter popup. */
  view: ReactNode;
  count?: number;
  actions: ReactNode;
}) {
  const phone = usePhone();
  const [searching, setSearching] = useState(false);
  const [filtering, setFiltering] = useState(false);
  // A search set from elsewhere (a caption tag) opens the phone's field so it shows what is
  // filtered; desktop always shows its box.
  useEffect(() => {
    if (query && phone) setSearching(true);
  }, [query, phone]);
  const chips = useActiveFilters({ kind, value, onChange }, extraChips);
  const clear = () => {
    onChange(emptyGalleryFilters);
    for (const chip of extraChips) chip.remove();
  };
  const toolbar = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
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
    if (phone && !searching) setSearching(true);
    else requestAnimationFrame(() => searchInput.current?.focus());
  }
  useHotkeys([
    ["/", openSearch, { preventDefault: false }],
    ["mod+f", openSearch, { preventDefault: false }],
  ]);
  function dismiss() {
    // Closing the phone's search ends it, so no hidden query keeps narrowing the gallery.
    onQueryChange("");
    setSearching(false);
    requestAnimationFrame(() => searchButton.current?.focus());
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
  // An empty view says so itself.
  const results = !count
    ? undefined
    : `${count.toLocaleString()} ${kind === "video" ? "Video" : "Image"}${count === 1 ? "" : "s"}`;
  if (phone && searching)
    return (
      <Group key="search" ref={toolbar} mih={44} wrap="nowrap" className={classes.mode}>
        {search}
      </Group>
    );
  return (
    <Group ref={toolbar} gap="xs" mih={44} wrap="nowrap" className={classes.mode}>
      {phone ? (
        <Tooltip label="Search Gallery">
          <Button
            {...iconChipProps}
            ref={searchButton}
            aria-label="Search Gallery"
            aria-expanded={false}
            variant={query ? "light" : "default"}
            onClick={() => setSearching(true)}
          >
            <Search size={16} />
          </Button>
        </Tooltip>
      ) : (
        search
      )}
      <FilterChips chips={chips} onClear={clear} />
      {results && !phone && (
        <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {results}
        </Text>
      )}
      {!phone && <ZoomSlider />}
      <ChipPopup
        title="Filters"
        opened={filtering}
        onOpenedChange={setFiltering}
        width={340}
        position="bottom-end"
        headerEnd={
          <>
            {phone && results && (
              <Text size="sm" c="dimmed">
                {results}
              </Text>
            )}
            <Button size="compact-sm" variant="subtle" disabled={!chips.length} onClick={clear}>
              Clear
            </Button>
          </>
        }
        target={
          <FilterButton
            label="Gallery Filters"
            count={chips.length}
            opened={filtering}
            onClick={() => setFiltering(!filtering)}
          />
        }
      >
        <GalleryFilterPanel kind={kind} value={value} onChange={onChange}>
          {view}
        </GalleryFilterPanel>
      </ChipPopup>
      {actions}
    </Group>
  );
}

/** Tile size: right makes tiles larger (fewer columns), holding the centre of the view in place. */
function ZoomSlider() {
  const { columns, min, max, zoomTo } = useGalleryColumns();
  return (
    <Group gap={6} wrap="nowrap" c="dimmed">
      <SquareMinus size={15} aria-hidden />
      <Slider
        className={classes.slider}
        size="xs"
        min={min}
        max={max}
        step={1}
        value={max + min - columns}
        onChange={(value) => zoomTo(max + min - value)}
        label={null}
        thumbLabel="Tile Size"
        aria-valuetext={`${columns} Columns`}
      />
      <SquarePlus size={15} aria-hidden />
    </Group>
  );
}
