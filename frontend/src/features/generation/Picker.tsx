import { useState, type DragEvent, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Image,
  Menu,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowDownUp,
  ArrowLeft,
  Check,
  Ellipsis,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "../../ui/EmptyState";
import { SearchInput } from "../../ui/SearchInput";
import editorClasses from "./GenerationEditor.module.css";
import classes from "./Picker.module.css";

/**
 * The References and LoRA pickers share one header, tile, grid and footer, so tabs, search,
 * filters, selection and actions look and behave the same in both and on every breakpoint.
 */

/** A phone panel's Back action and title, shown in place of the composer form. */
export function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <Group justify="space-between">
      <Button
        autoFocus
        variant="subtle"
        color="gray"
        leftSection={<ArrowLeft size={16} />}
        onClick={onBack}
      >
        Back
      </Button>
      <Text fw={500}>{title}</Text>
    </Group>
  );
}

/** Tabs, an inline search and a filter toggle on one row; the filters open inline below it. */
export function PickerHeader<Tab extends string>({
  label,
  tabs,
  tab,
  onTabChange,
  query,
  onQueryChange,
  placeholder,
  filters,
  filterCount = 0,
  actions,
}: {
  /** Names the search and filters, such as "References" or "LoRAs". */
  label: string;
  tabs?: { value: Tab; label: string }[];
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  filters?: ReactNode;
  filterCount?: number;
  actions?: ReactNode;
}) {
  const [filtering, setFiltering] = useState(false);
  const open = filtering && !!filters;
  return (
    <Box className={classes.header}>
      <div className={classes.headerRow}>
        {tabs && (
          <SegmentedControl
            aria-label={`${label} View`}
            className={classes.tabs}
            value={tab}
            onChange={(value) => onTabChange?.(value as Tab)}
            data={tabs}
          />
        )}
        <SearchInput
          className={classes.search}
          data-autofocus
          aria-label={`Search ${label}`}
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onClear={() => onQueryChange("")}
        />
        {actions}
        {filters && (
          <Tooltip label={`Filter ${label}`}>
            <ActionIcon
              aria-label={`Filter ${label}`}
              aria-expanded={open}
              variant={open || filterCount ? "light" : "subtle"}
              color={open || filterCount ? undefined : "gray"}
              pos="relative"
              onClick={() => setFiltering(!open)}
            >
              <SlidersHorizontal size={18} />
              {filterCount > 0 && (
                <Badge size="xs" circle pos="absolute" top={0} right={0} aria-hidden>
                  {filterCount}
                </Badge>
              )}
            </ActionIcon>
          </Tooltip>
        )}
      </div>
      {open && (
        <div className={classes.filters} role="group" aria-label={`${label} Filters`}>
          {filters}
        </div>
      )}
    </Box>
  );
}

/**
 * Drags just the picture at its shown size: a laid-out copy off screen, since the browser draws
 * an element with its border and rounded corners, and an image at its full intrinsic size.
 */
export function dragPicture(data: DataTransfer, picture: HTMLImageElement) {
  const { width, height } = picture.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = classes.ghost;
  ghost.style.width = `${width}px`;
  ghost.style.height = `${height}px`;
  ghost.append(picture.cloneNode());
  document.body.append(ghost);
  data.setDragImage(ghost, width / 2, height / 2);
  requestAnimationFrame(() => ghost.remove());
}

/** Tiles in a responsive grid, or roomy rows on phones where each tile has text. */
export function PickerGrid({
  label,
  rows = false,
  children,
}: {
  label: string;
  rows?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={classes.grid} data-rows={rows || undefined} role="list" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * One choice. A selected tile fades with a check and clicking it again removes it. Dragging
 * shows only the picture, without the tile's border and corners.
 */
export function PickerTile({
  label,
  selected,
  onToggle,
  disabled = false,
  image,
  placeholder: Placeholder,
  aspect = "1",
  title,
  detail,
  action,
  drag,
  row = false,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  image?: string;
  placeholder?: LucideIcon;
  /** The picture's aspect ratio, such as "4 / 3". */
  aspect?: string;
  title?: string;
  detail?: string;
  /** A corner control such as Favourite or Delete. */
  action?: ReactNode;
  drag?: [type: string, data: string];
  row?: boolean;
}) {
  const [state, setState] = useState<"loaded" | "failed">();
  function dragStart(event: DragEvent<HTMLButtonElement>) {
    if (!drag) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(...drag);
    const picture = event.currentTarget.querySelector("img");
    if (picture?.complete && picture.naturalWidth) dragPicture(event.dataTransfer, picture);
  }
  return (
    <div
      className={classes.tile}
      role="listitem"
      data-row={row || undefined}
      data-selected={selected || undefined}
    >
      <UnstyledButton
        className={classes.toggle}
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled && !selected}
        onClick={onToggle}
        draggable={!!drag}
        onDragStart={dragStart}
      >
        <div className={classes.media} style={{ aspectRatio: aspect }}>
          {Placeholder && <Placeholder size={row ? 18 : 22} aria-hidden />}
          {image && (
            <Image
              className={classes.image}
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              data-loaded={state === "loaded" || undefined}
              data-failed={state === "failed" || undefined}
              onLoad={() => setState("loaded")}
              onError={() => setState("failed")}
            />
          )}
          <span className={classes.check} aria-hidden>
            <Check size={14} strokeWidth={3} />
          </span>
        </div>
        {title && (
          <div className={classes.text}>
            <Text size="sm" fw={500} truncate>
              {title}
            </Text>
            {detail && (
              <Text size="xs" c="dimmed" truncate>
                {detail}
              </Text>
            )}
          </div>
        )}
      </UnstyledButton>
      {action && <div className={classes.action}>{action}</div>}
    </div>
  );
}

/** Thumbnails for a chip: overlapping like a stack, the first few and then a count. */
export function ChipThumbnails({
  items,
  placeholder: Placeholder,
  max = 3,
}: {
  items: { key: string; label: string; src?: string; off?: boolean }[];
  placeholder: LucideIcon;
  max?: number;
}) {
  const shown = items.length > max ? items.slice(0, max - 1) : items;
  return (
    <span className={classes.thumbs}>
      {shown.map((item) => (
        <span
          key={item.key}
          className={classes.thumb}
          data-off={item.off || undefined}
          title={item.label}
        >
          {item.src ? (
            <Image src={item.src} alt={item.label} fallbackSrc="" />
          ) : (
            <Placeholder size={14} aria-label={item.label} />
          )}
        </span>
      ))}
      {items.length > shown.length && (
        <span className={classes.more}>+{items.length - shown.length}</span>
      )}
    </span>
  );
}

export type SavedSort = "name-asc" | "name-desc" | "newest" | "oldest";
const sortLabels: Record<SavedSort, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  newest: "Newest First",
  oldest: "Oldest First",
};
export interface SavedItem {
  id: string;
  name: string;
  /** When it was saved; older records without one sort by their place in the list. */
  savedAt?: string;
}

/** Saved items filtered by the query and sorted; `items` arrive oldest first. */
export function savedItems<T extends SavedItem>(items: T[], query: string, sort: SavedSort) {
  const terms = query.trim().toLocaleLowerCase();
  const time = (item: T, index: number) => Date.parse(item.savedAt || "") || index;
  return items
    .map((item, index) => ({ item, at: time(item, index) }))
    .filter(({ item }) => !terms || item.name.toLocaleLowerCase().includes(terms))
    .sort((a, b) =>
      sort === "name-asc"
        ? a.item.name.localeCompare(b.item.name)
        : sort === "name-desc"
          ? b.item.name.localeCompare(a.item.name)
          : sort === "newest"
            ? b.at - a.at
            : a.at - b.at,
    )
    .map(({ item }) => item);
}

/** The header action that sorts saved stacks and presets. */
export function SortMenu({
  value,
  onChange,
}: {
  value: SavedSort;
  onChange: (sort: SavedSort) => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal={false}>
      <Menu.Target>
        <Tooltip label={`Sort: ${sortLabels[value]}`}>
          <ActionIcon aria-label="Sort" variant="subtle" color="gray">
            <ArrowDownUp size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {(Object.keys(sortLabels) as SavedSort[]).map((sort) => (
          <Menu.Item
            key={sort}
            role="menuitemradio"
            aria-checked={sort === value}
            rightSection={sort === value ? <Check size={14} /> : undefined}
            onClick={() => onChange(sort)}
          >
            {sortLabels[sort]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Saved stacks and presets: choosing one loads it, asking first when it would replace what is
 * there; each row renames, updates from the current settings or deletes from its menu.
 */
export function SavedList<T extends SavedItem>({
  label,
  noun,
  items,
  current,
  empty,
  replaces,
  replaceMessage,
  onLoad,
  onRename,
  onUpdate,
  onDelete,
}: {
  label: string;
  /** Names the record in actions, such as "Stack" or "Preset". */
  noun: string;
  items: T[];
  current?: string;
  empty: string;
  /** Whether loading would overwrite the current selection, so it asks first. */
  replaces: boolean;
  replaceMessage: string;
  onLoad: (item: T) => void;
  onRename: (item: T, name: string) => void;
  onUpdate?: (item: T) => void;
  onDelete: (item: T) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!items.length) return <EmptyState fill>{empty}</EmptyState>;
  return (
    <div className={classes.saved} role="list" aria-label={label}>
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <div className={classes.savedRow} data-current={item.id === current || undefined}>
            {renaming === item.id ? (
              <TextInput
                flex={1}
                autoFocus
                aria-label={`${noun} Name`}
                defaultValue={item.name}
                data-mantine-stop-propagation
                onBlur={() => setRenaming(null)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenaming(null);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const name = event.currentTarget.value.trim();
                    if (name && name !== item.name) onRename(item, name);
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <UnstyledButton
                className={classes.savedName}
                aria-label={`Load ${noun}: ${item.name}`}
                onClick={() => (replaces ? setConfirming(item.id) : onLoad(item))}
              >
                <Text size="sm" truncate>
                  {item.name}
                </Text>
              </UnstyledButton>
            )}
            <Menu position="bottom-end" withinPortal={false}>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={`${noun} Actions for ${item.name}`}
                >
                  <Ellipsis size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setRenaming(item.id)}>Rename {noun}</Menu.Item>
                {onUpdate && (
                  <Menu.Item onClick={() => onUpdate(item)}>Update From Current</Menu.Item>
                )}
                <Menu.Item color="red" onClick={() => onDelete(item)}>
                  Delete {noun}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
          {confirming === item.id && (
            <Group className={classes.reveal} justify="space-between" gap="xs" p="xs">
              <Text size="sm">{replaceMessage}</Text>
              <Group gap="xs">
                <Button variant="default" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setConfirming(null);
                    onLoad(item);
                  }}
                >
                  Replace
                </Button>
              </Group>
            </Group>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The footer's Save action: it asks for a name in place and saves on Enter, like Recent Prompts'
 * Pin Current Prompt sitting at the start of the footer.
 */
export function SaveCurrent({
  noun,
  disabled,
  pending,
  onSave,
}: {
  noun: string;
  disabled: boolean;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const save = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName("");
    setNaming(false);
  };
  if (!naming)
    return (
      <Button
        variant="default"
        disabled={disabled}
        loading={pending}
        onClick={() => setNaming(true)}
      >
        Save {noun}
      </Button>
    );
  return (
    <Group className={classes.reveal} gap="xs" wrap="nowrap">
      <TextInput
        autoFocus
        aria-label={`${noun} Name`}
        placeholder={`${noun} name`}
        value={name}
        data-mantine-stop-propagation
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setNaming(false);
          }
        }}
      />
      <Button disabled={!name.trim()} onClick={save}>
        Save
      </Button>
    </Group>
  );
}

/** Secondary actions at the start and end, like Recent Prompts; sheets add their full-width done action. */
export function PickerFooter({
  start,
  end,
  done,
}: {
  start?: ReactNode;
  end?: ReactNode;
  /** The phone sheet's closing action, such as Use References. */
  done?: { label: string; onClick: () => void };
}) {
  const row = (start || end) && (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Group gap="xs">{start}</Group>
      <Group gap="xs">{end}</Group>
    </Group>
  );
  if (!done) return row || null;
  return (
    <Box className={`${editorClasses.footer} ${classes.footer}`} data-sticky>
      {row}
      <Button fullWidth onClick={done.onClick}>
        {done.label}
      </Button>
    </Box>
  );
}
