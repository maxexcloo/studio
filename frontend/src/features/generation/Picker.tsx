import {
  useRef,
  useState,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Image,
  Menu,
  Modal,
  Popover,
  type PopoverProps,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { ArrowDownUp, Check, Ellipsis, type LucideIcon } from "lucide-react";
import { FilterButton } from "../gallery/GalleryFilters";
import { EmptyState } from "../../ui/EmptyState";
import { SearchInput } from "../../ui/SearchInput";
import { usePhone } from "../../ui/usePhone";
import { escapePanel } from "./chip";
import classes from "./Picker.module.css";

/**
 * The References and LoRA pickers share one header, tile, grid and footer, so tabs, search,
 * filters, selection and actions look and behave the same in both and on every breakpoint.
 */

/**
 * A chip's popup, laid out like Recent Prompts: a title row with its few controls (such as Clear),
 * then the content. Desktop anchors a Popover to the chip; phones open a full-screen Modal, so a
 * popover never opens a second level there. Escape closes nested layers first.
 */
export function ChipPopup({
  title,
  opened,
  onOpenedChange,
  target,
  tooltip = false,
  headerEnd,
  width,
  position = "top-start",
  trap = true,
  children,
}: {
  title: string;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  target: ReactNode;
  /** Icon-only chips name themselves with the title's tooltip. */
  tooltip?: boolean;
  headerEnd?: ReactNode;
  width: number | string;
  position?: PopoverProps["position"];
  /** Off while a confirmation over the popup owns focus and clicks. */
  trap?: boolean;
  children: ReactNode;
}) {
  const phone = usePhone();
  const close = () => onOpenedChange(false);
  // The popup handles its own Escape, so the composer's Drawer behind it stays open.
  const layer = {
    "data-composer-layer": true,
    "data-chip-popup": true,
    "aria-label": title,
    onFocusCapture: (event: FocusEvent<HTMLElement>) =>
      event.target.setAttribute("data-mantine-stop-propagation", "true"),
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => trap && escapePanel(event, close);
  const end = headerEnd && (
    <Group gap="xs" wrap="nowrap">
      {headerEnd}
    </Group>
  );
  if (phone)
    return (
      <>
        {target}
        <Modal.Root
          opened={opened}
          onClose={close}
          fullScreen
          trapFocus={trap}
          closeOnEscape={false}
          returnFocus
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so the phone popup listens in the capture phase. */}
          <Modal.Content {...layer} onKeyDownCapture={onKeyDown}>
            <Modal.Header>
              <Modal.Title>{title}</Modal.Title>
              <Group gap="xs" wrap="nowrap">
                {end}
                <Modal.CloseButton aria-label={`Close ${title}`} />
              </Group>
            </Modal.Header>
            <Modal.Body>{children}</Modal.Body>
          </Modal.Content>
        </Modal.Root>
      </>
    );
  return (
    <Popover
      opened={opened}
      onChange={onOpenedChange}
      width={width}
      position={position}
      trapFocus={trap}
      closeOnClickOutside={trap}
      closeOnEscape={false}
      returnFocus
      shadow="md"
    >
      <Tooltip label={title} disabled={!tooltip || opened}>
        <Popover.Target>{target}</Popover.Target>
      </Tooltip>
      <Popover.Dropdown
        {...layer}
        aria-labelledby=""
        maw="calc(100vw - 24px)"
        onKeyDown={onKeyDown}
      >
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap" mih={28}>
            <Text fw={500}>{title}</Text>
            {end}
          </Group>
          {children}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Tabs, an inline search and a filter toggle on one row; the filters open inline below it. */
export function PickerHeader<Tab extends string>({
  label,
  searched = label,
  tabs,
  tab,
  onTabChange,
  query,
  onQueryChange,
  placeholder,
  filters,
  filterCount = 0,
  chips,
  actions,
}: {
  /** The active filters as removable chips, beside the search. */
  chips?: ReactNode;
  /** Names the picker, such as "References" or "LoRAs". */
  label: string;
  /** What the search and filters cover, such as the current tab's "Gallery". */
  searched?: string;
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
          aria-label={`Search ${searched}`}
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onClear={() => onQueryChange("")}
        />
        {actions}
        {chips}
        {filters && (
          <FilterButton
            label={`Filter ${searched}`}
            count={filterCount}
            opened={open}
            onClick={() => setFiltering(!open)}
          />
        )}
      </div>
      {open && (
        <div className={classes.filters} role="group" aria-label={`${searched} Filters`}>
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
  /** A note under the name, such as where an older record came from. */
  detail?: string;
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
      <Tooltip label={`Sort: ${sortLabels[value]}`}>
        <Menu.Target>
          <ActionIcon aria-label="Sort" variant="subtle" color="gray">
            <ArrowDownUp size={18} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
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
                aria-current={item.id === current || undefined}
                onClick={() => (replaces ? setConfirming(item.id) : onLoad(item))}
              >
                <Text size="sm" truncate>
                  {item.name}
                </Text>
                {item.detail && (
                  <Text size="xs" c="dimmed" truncate>
                    {item.detail}
                  </Text>
                )}
              </UnstyledButton>
            )}
            {/* Rename focuses its field, so the closing menu must not take focus back. */}
            <Menu position="bottom-end" withinPortal={false} returnFocus={false}>
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
  onSave,
}: {
  noun: string;
  disabled: boolean;
  onSave: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // Focus returns to Save after naming, so the composer keeps focus and stays open.
  const named = useRef(false);
  const finish = () => {
    named.current = true;
    setNaming(false);
  };
  const save = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName("");
    finish();
  };
  if (!naming)
    return (
      <Button
        variant="default"
        autoFocus={named.current}
        disabled={disabled}
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
            finish();
          }
        }}
      />
      <Button disabled={!name.trim()} onClick={save}>
        Save
      </Button>
    </Group>
  );
}

/** Secondary actions at the start and end, like Recent Prompts. */
export function PickerFooter({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  if (!start && !end) return null;
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Group gap="xs">{start}</Group>
      <Group gap="xs">{end}</Group>
    </Group>
  );
}
