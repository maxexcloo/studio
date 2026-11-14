import {
  ActionIcon,
  Box,
  Button,
  Combobox,
  FocusTrap,
  Group,
  Image,
  InputBase,
  Menu,
  Modal,
  Popover,
  type PopoverProps,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  getDefaultZIndex,
  useCombobox,
} from "@mantine/core";
import { ArrowDownUp, Check, type LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";

import { menuWidth } from "../../theme";
import { formatDateTime } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { ScrollingSegments } from "../../ui/ScrollingSegments";
import { SearchInput } from "../../ui/SearchInput";
import { useFlash } from "../../ui/useFlash";
import { usePhone, useTouch } from "../../ui/usePhone";
import { useSwipeClose } from "../../ui/useSwipeClose";
import { FilterButton } from "../gallery/GalleryFilters";
import type { PreviewImage } from "../gallery/ImagePreview";
import { escapePanel, fittedPopup } from "./chip";

import classes from "./Picker.module.css";

/**
 * The References and LoRA pickers share one header, tile, grid and footer, so tabs, search,
 * filters, selection and actions look and behave the same in both and on every breakpoint.
 */

/**
 * A popup's or column's heading: its title and any `detail`, with its actions, such as Clear, at
 * the end.
 */
export function PopupHeading({
  title,
  detail,
  actions,
}: {
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Group className={classes.heading} justify="space-between" gap="xs" mih={28}>
      <Group gap="xs" wrap="nowrap" miw={0}>
        <Text fw={500}>{title}</Text>
        {detail}
      </Group>
      {actions && (
        <Group className={classes.actions} justify="flex-end" gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}

/**
 * A chip's popup: a `PopupHeading` with the title and its actions, the content, then any `footer`
 * actions. An `aside`, such as the LoRA stack, starts with its own `PopupHeading`: desktop shows it
 * as a column beside everything else, divided to the top; phones leave it out.
 * Desktop anchors a Popover to the chip; phones open a full-screen sheet whose content scrolls
 * between the header and the footer, pinned above the safe area, which holds the heading's actions
 * (`headerEnd`, such as Clear and Save) at its end, so a popover never opens a second
 * level there, unless the popup is `floating`: a small form, such as Settings, stays a
 * popover fitted to the screen, as the rail's other dropdowns. Escape closes nested layers first.
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
  withinPortal = true,
  floating = false,
  footer,
  aside,
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
  /** Off for a popup inside another, so pressing in it is not outside its parent. */
  withinPortal?: boolean;
  /** A popover on phones too, instead of a full-screen sheet. */
  floating?: boolean;
  /**
   * Actions under the content: `start` (such as Pin Current Prompt), with Clear and Save in the
   * heading, or after `start` in the phone sheet's footer. `apply` adds Apply to the phone sheet,
   * which closes it; choices apply as they are made.
   */
  footer?: { start?: ReactNode; apply?: boolean };
  aside?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  const touch = useTouch();
  const close = () => onOpenedChange(false);
  // Pulling the phone sheet down by its header, or its content from the top, closes it.
  const swipe = useSwipeClose("down", close);
  // The popup handles its own Escape, so the composer's Drawer behind it stays open. A dialog it
  // opens, such as a card editor, portals elsewhere and keeps its own Escape.
  const layer = {
    "data-composer-layer": true,
    "data-chip-popup": true,
    "aria-label": title,
    onFocusCapture: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.target))
        event.target.setAttribute("data-mantine-stop-propagation", "true");
    },
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => trap && escapePanel(event, close);
  const actions = footer?.start && (
    <Group gap="xs" wrap="nowrap">
      {footer.start}
    </Group>
  );
  // The phone sheet's footer: `start`, then the heading's actions and Apply at the end.
  const sheetActions = (headerEnd || footer) && (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Group className={classes.footerStart} gap="xs" wrap="nowrap">
        {footer?.start}
      </Group>
      <Group className={classes.actions} justify="flex-end" gap="xs" wrap="nowrap">
        {headerEnd}
        {footer?.apply && <Button onClick={close}>Apply</Button>}
      </Group>
    </Group>
  );
  if (phone && !floating)
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
          // A column of header, body and footer. Inline, since Paper's `display: block` has a
          // module class's specificity and Modal.Content's own class lands on its wrapper too.
          styles={{ content: { display: "flex", flexDirection: "column" } }}
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so the phone popup listens in the capture phase. */}
          <Modal.Content {...layer} {...swipe} onKeyDownCapture={onKeyDown}>
            {/* The sheet itself takes focus, so its search doesn't raise the keyboard. */}
            <FocusTrap.InitialFocus />
            <Modal.Header className={classes.sheetHeader}>
              <Modal.Title>{title}</Modal.Title>
              <Modal.CloseButton aria-label={`Close ${title}`} />
            </Modal.Header>
            <Modal.Body className={classes.sheetBody}>{children}</Modal.Body>
            {sheetActions && <div className={classes.sheetFooter}>{sheetActions}</div>}
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
      withinPortal={withinPortal}
      {...fittedPopup}
    >
      <PopupTooltip label={title} disabled={!tooltip}>
        <Popover.Target>{target}</Popover.Target>
      </PopupTooltip>
      <Popover.Dropdown
        {...layer}
        aria-labelledby=""
        maw="calc(100vw - 24px)"
        onKeyDown={onKeyDown}
      >
        {/* Touch screens focus the popup itself, so its first field doesn't raise the keyboard. */}
        {touch && <FocusTrap.InitialFocus />}
        <div className={aside ? classes.columns : undefined}>
          <Stack gap="sm">
            <PopupHeading title={title} actions={headerEnd} />
            {children}
            {actions}
          </Stack>
          {aside && <div className={classes.aside}>{aside}</div>}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * Tabs, then the search, Filter ▾ and `actions` in one compact row, in the gallery toolbar's order
 * and size; Filter ▾ opens the filters in a popup, as the gallery's does, and counts those applied
 * so choosing them never reflows the row.
 */
export function PickerHeader<Tab extends string>({
  label,
  searched = label,
  tabs,
  tab,
  onTabChange,
  query,
  onQueryChange,
  filters,
  filterCount = 0,
  onClearFilters,
  actions,
}: {
  /** Names the picker, such as "References" or "LoRAs". */
  label: string;
  /** What the search and filters cover, such as the current tab's "Gallery". */
  searched?: string;
  /** The views in one bar, its groups divided, such as the gallery's and the Library's. */
  tabs?: { value: Tab; label: string }[][];
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  filters?: ReactNode;
  filterCount?: number;
  onClearFilters?: () => void;
  actions?: ReactNode;
}) {
  const [filtering, setFiltering] = useState(false);
  return (
    <Box className={classes.header}>
      <div className={classes.headerRow}>
        {tabs && (
          <ScrollingSegments
            aria-label={`${label} View`}
            classNames={{ control: classes.tab }}
            value={tab}
            onChange={(value) => onTabChange?.(value as Tab)}
            data={tabs.flatMap((group, index) =>
              group.map((item, position) => ({
                value: item.value,
                label: index && !position ? <span data-group-start>{item.label}</span> : item.label,
              })),
            )}
          />
        )}
        <div className={classes.searchRow}>
          <SearchInput
            className={classes.search}
            data-autofocus
            aria-label={`Search ${searched}`}
            size="sm"
            radius="xl"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onClear={() => onQueryChange("")}
          />
          {filters && (
            <ChipPopup
              title="Filters"
              opened={filtering}
              onOpenedChange={setFiltering}
              width={340}
              position="bottom-end"
              withinPortal={false}
              headerEnd={
                onClearFilters && (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    disabled={!filterCount}
                    onClick={onClearFilters}
                  >
                    Clear
                  </Button>
                )
              }
              target={
                <FilterButton
                  label={`Filter ${searched}`}
                  count={filterCount}
                  opened={filtering}
                  onClick={() => setFiltering(!filtering)}
                />
              }
            >
              {filters}
            </ChipPopup>
          )}
          {actions}
        </div>
      </div>
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
  ref,
  style,
  children,
}: {
  label: string;
  rows?: boolean;
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className={classes.grid}
      data-rows={rows || undefined}
      role="list"
      aria-label={label}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * One choice. A selected tile fades with a check and clicking it again removes it. Dragging
 * shows only the picture, without the tile's border and corners. A `preview` opens from a corner
 * button or Space; on desktop, with an `image`, hovering that button or Space shows the image larger
 * beside the tile instead, and the button still opens it.
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
  preview,
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
  /** A corner control such as a LoRA's rating or Delete. */
  action?: ReactNode;
  drag?: [type: string, data: string];
  preview?: { label: string; open: () => void; image?: PreviewImage };
  row?: boolean;
}) {
  const [state, setState] = useState<"loaded" | "failed">();
  const peekable = !useTouch() && Boolean(preview?.image);
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef(0);
  const hover = (on: boolean) => {
    window.clearTimeout(peekTimer.current);
    if (on) peekTimer.current = window.setTimeout(() => setPeek(true), 400);
    else setPeek(false);
  };
  function dragStart(event: DragEvent<HTMLButtonElement>) {
    if (!drag) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(...drag);
    const picture = event.currentTarget.querySelector("img");
    if (picture?.complete && picture.naturalWidth) dragPicture(event.dataTransfer, picture);
  }
  return (
    <Popover
      opened={peekable && peek}
      onChange={setPeek}
      position="right"
      width={320}
      withRoles={false}
      returnFocus={false}
      zIndex={getDefaultZIndex("max")}
    >
      <Popover.Target>
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
            onKeyDown={(event) => {
              // Escape closes only the image beside the tile, leaving the picker open.
              if (event.key === "Escape" && peek) {
                event.preventDefault();
                event.stopPropagation();
                setPeek(false);
              }
              if (event.key !== " " || !preview) return;
              event.preventDefault();
              if (event.repeat) return;
              if (peekable) setPeek(!peek);
              else preview.open();
            }}
            onBlur={() => setPeek(false)}
            // Space previews rather than toggling, which a button does as the key comes up.
            onKeyUp={(event) => preview && event.key === " " && event.preventDefault()}
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
          {(action || preview) && (
            <Group className={classes.action} gap={4} wrap="nowrap">
              {preview && (
                <Tooltip label="Preview" disabled={peek}>
                  <ActionIcon
                    variant="default"
                    aria-label={preview.label}
                    // Expanded, a press on it opens the preview rather than only closing the image.
                    aria-expanded={peekable ? peek : undefined}
                    onMouseEnter={() => peekable && hover(true)}
                    onMouseLeave={() => hover(false)}
                    onClick={() => {
                      hover(false);
                      preview.open();
                    }}
                  >
                    <icons.preview size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              {action}
            </Group>
          )}
        </div>
      </Popover.Target>
      {preview?.image && (
        <Popover.Dropdown p={4} className={classes.peek}>
          <Image src={preview.image.src} alt={preview.image.alt} radius="sm" />
        </Popover.Dropdown>
      )}
    </Popover>
  );
}

/**
 * A picker chip's content: its name, always in place, after one fixed-size picture that shows the
 * icon until items are chosen, then their thumbnails stacked with a count, so the chip keeps one
 * width as items come and go.
 */
export function ChipContent({
  label,
  icon: Icon,
  items,
}: {
  label: string;
  icon: LucideIcon;
  items: { key: string; label: string; src?: string; off?: boolean }[];
}) {
  const max = 3;
  return (
    <span className={classes.chipContent}>
      <span className={classes.stack}>
        {items.length ? (
          items.slice(0, max).map((item, index) => (
            <span
              key={item.key}
              className={classes.thumb}
              data-off={item.off || undefined}
              title={item.label}
              style={{ zIndex: max - index, translate: `${index * 2}px 0` }}
            >
              {item.src ? (
                <Image src={item.src} alt={item.label} fallbackSrc="" />
              ) : (
                <Icon size={14} aria-label={item.label} />
              )}
            </span>
          ))
        ) : (
          <Icon size={16} />
        )}
        {items.length > 1 && (
          <span className={classes.count} aria-hidden>
            {items.length}
          </span>
        )}
      </span>
      {label}
    </span>
  );
}

export type SavedSort = "name-asc" | "name-desc" | "newest" | "oldest";
export const savedSortLabels: Record<SavedSort, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  newest: "Newest First",
  oldest: "Oldest First",
};
interface SavedItem {
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

/** The header action that sorts a picker's list: saved stacks and presets, and the LoRAs. */
export function SortMenu<Sort extends string>({
  label = "Sort",
  labels,
  value,
  onChange,
}: {
  label?: string;
  /** Each order's name, in menu order, such as `savedSortLabels`. */
  labels: Record<Sort, string>;
  value: Sort;
  onChange: (sort: Sort) => void;
}) {
  return (
    <Menu position="bottom-end" withinPortal={false}>
      <PopupTooltip label={`Sort: ${labels[value]}`}>
        <Menu.Target>
          <ActionIcon aria-label={label} variant="subtle" color="gray">
            <ArrowDownUp size={18} />
          </ActionIcon>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        {(Object.keys(labels) as Sort[]).map((sort) => (
          <Menu.Item
            key={sort}
            role="menuitemradio"
            aria-checked={sort === value}
            rightSection={sort === value ? <Check size={14} /> : undefined}
            onClick={() => onChange(sort)}
          >
            {labels[sort]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The Library's imported images in the Presets popup: choosing one loads it, asking first when it
 * would replace what is there.
 */
export function SavedList<T extends SavedItem>({
  label,
  items,
  empty,
  replaces,
  replaceMessage,
  onLoad,
}: {
  label: string;
  items: T[];
  empty: string;
  /** Whether loading would overwrite the current draft, so it asks first. */
  replaces: boolean;
  replaceMessage: string;
  onLoad: (item: T) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!items.length) return <EmptyState fill>{empty}</EmptyState>;
  return (
    <div className={classes.saved} role="list" aria-label={label}>
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <div className={classes.savedRow}>
            <UnstyledButton
              className={classes.savedName}
              aria-label={`Load: ${item.name}`}
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
          </div>
          {confirming === item.id && (
            <ReplaceConfirm
              message={replaceMessage}
              onCancel={() => setConfirming(null)}
              onReplace={() => {
                setConfirming(null);
                onLoad(item);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Asks in place before a saved record replaces the draft. */
function ReplaceConfirm({
  message,
  onCancel,
  onReplace,
}: {
  message: string;
  onCancel: () => void;
  onReplace: () => void;
}) {
  return (
    <Group className={classes.reveal} justify="space-between" gap="xs" p="xs">
      <Text size="sm">{message}</Text>
      <Group gap="xs">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onReplace}>Replace</Button>
      </Group>
    </Group>
  );
}

/** What a saved name's field and its Save share: naming it, and Saved shown for a moment. */
export function useNaming() {
  const [naming, setNaming] = useState<"save" | "rename" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [saved, flashSaved] = useFlash();
  /** Focuses the name field to save the draft as new or rename the current record. */
  const name = (mode: "save" | "rename" | null) => {
    setNaming(mode);
    if (mode) setTimeout(() => field.current?.focus());
  };
  return { naming, name, field, saved, flashSaved };
}
type Naming = ReturnType<typeof useNaming>;
/** A failed save shows the shared mutation notification; the field just stays as it is. */
const ignore = () => {};

/**
 * Save for the current preset: it updates the record the draft came from when the draft has
 * changed, or names a new one in the name field.
 */
export function SaveButton<T extends SavedItem>({
  noun,
  naming,
  current,
  edited,
  disabled,
  onUpdate,
}: {
  noun: string;
  naming: Naming;
  current?: T;
  edited: boolean;
  disabled: boolean;
  onUpdate: (record: T) => Promise<unknown>;
}) {
  const phone = usePhone();
  return (
    <Button
      size="compact-sm"
      variant="subtle"
      // A phone sheet's footer is one tight row, beside the record's name above.
      aria-label={`Save ${noun}`}
      disabled={disabled || (!!current && !edited)}
      onClick={() =>
        current
          ? onUpdate(current).then(() => naming.flashSaved(true), ignore)
          : naming.name("save")
      }
    >
      {phone ? "Save" : `Save ${noun}`}
    </Button>
  );
}

/**
 * A saved record's name as a combobox: it shows the current record's name, or Unsaved, marked
 * Edited once the draft differs and Saved for a moment after saving. Its list loads a saved record,
 * asking first where `replaces` says what it would replace; typing searches the list or names the
 * draft to save it as new or rename the current record. Names stay unique; duplicates from before
 * show when each was saved. Its menu holds `menu` (such as what a preset saves), then Rename, Save
 * as New and Delete.
 */
export function SavedName<T extends SavedItem>({
  noun,
  naming,
  records,
  current,
  edited,
  canSave,
  replaces,
  menu,
  onLoad,
  onSave,
  onRename,
  onDelete,
}: {
  noun: string;
  naming: Naming;
  records: T[];
  current?: T;
  edited: boolean;
  /** Whether the draft holds anything to save. */
  canSave: boolean;
  /** What loading `record` asks first, or nothing when the draft has nothing unsaved. */
  replaces: (record: T) => string | undefined;
  menu?: ReactNode;
  onLoad: (record: T) => void;
  onSave: (name: string) => Promise<unknown>;
  onRename: (record: T, name: string) => Promise<unknown>;
  onDelete: (record: T) => void;
}) {
  // What is typed; null shows the current record's name.
  const [text, setText] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ record: T; message: string }>();
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setText(null);
      naming.name(null);
    },
  });
  const mode = naming.naming;
  const typed = (text ?? "").trim();
  const key = (name: string) => name.toLocaleLowerCase();
  const taken = records.some((record) => key(record.name) === key(typed));
  const matches = mode
    ? []
    : records
        .filter((record) => text === null || key(record.name).includes(key(typed)))
        .sort((a, b) => a.name.localeCompare(b.name));
  const actions: { value: string; label: string }[] = [];
  if (typed && !taken) {
    if (mode !== "rename" && canSave)
      actions.push({ value: "\0save", label: `Save as New ${noun} “${typed}”` });
    if (current && mode !== "save")
      actions.push({ value: "\0rename", label: `Rename to “${typed}”` });
  }
  if (mode === "rename") actions.reverse();
  const empty = mode
    ? typed
      ? `A ${noun.toLowerCase()} has this name`
      : "Type a Name"
    : records.length
      ? "No Matches"
      : `No Saved ${noun}s`;
  const shared = (name: string) => records.filter((record) => record.name === name).length > 1;
  useEffect(() => {
    if (text !== null) combobox.selectFirstOption();
  }, [text]);
  const submit = async (value: string) => {
    combobox.closeDropdown();
    if (value === "\0save") {
      await onSave(typed).then(() => naming.flashSaved(true), ignore);
      return;
    }
    if (value === "\0rename") {
      if (current) await onRename(current, typed).then(() => naming.flashSaved(true), ignore);
      return;
    }
    const record = records.find((item) => item.id === value);
    // Choosing the current record again restores it, once the draft has changed.
    if (!record || (record === current && !edited)) return;
    const message = replaces(record);
    if (message) setConfirming({ record, message });
    else onLoad(record);
  };
  const marker = naming.saved ? "Saved" : edited && "Edited";
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap">
        <Combobox store={combobox} withinPortal={false} onOptionSubmit={submit}>
          <Combobox.Target withExpandedAttribute>
            <InputBase
              ref={naming.field}
              flex={1}
              miw={0}
              aria-label={`${noun} Name`}
              placeholder={`Unsaved ${noun}`}
              value={text ?? current?.name ?? ""}
              data-mantine-stop-propagation
              rightSection={
                <Group gap={4} wrap="nowrap">
                  {marker && (
                    <Text size="xs" c={naming.saved ? "green" : "dimmed"}>
                      {marker}
                    </Text>
                  )}
                  <Combobox.Chevron />
                </Group>
              }
              rightSectionWidth={marker ? 80 : undefined}
              rightSectionPointerEvents="none"
              onClick={() => combobox.openDropdown()}
              onFocus={(event) => {
                event.currentTarget.select();
                combobox.openDropdown();
              }}
              onBlur={() => combobox.closeDropdown()}
              onChange={(event) => {
                setText(event.currentTarget.value);
                combobox.openDropdown();
              }}
            />
          </Combobox.Target>
          <Combobox.Dropdown>
            <Combobox.Options aria-label={`Saved ${noun}s`}>
              <ScrollArea.Autosize mah={240} type="scroll">
                {matches.map((record) => (
                  <Combobox.Option
                    key={record.id}
                    value={record.id}
                    active={record === current}
                    aria-label={record.name}
                  >
                    <Group gap="xs" wrap="nowrap" justify="space-between">
                      <Stack gap={0} miw={0}>
                        <Text size="sm" fw={record === current ? 600 : undefined} truncate>
                          {record.name}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {[
                            record.detail,
                            shared(record.name) &&
                              (record.savedAt
                                ? `Saved ${formatDateTime(record.savedAt)}`
                                : "Saved Earlier"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </Stack>
                      {record === current && <Check size={14} />}
                    </Group>
                  </Combobox.Option>
                ))}
                {actions.map((action) => (
                  <Combobox.Option key={action.value} value={action.value}>
                    <Text size="sm">{action.label}</Text>
                  </Combobox.Option>
                ))}
                {!matches.length && !actions.length && <Combobox.Empty>{empty}</Combobox.Empty>}
              </ScrollArea.Autosize>
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
        <Menu position="bottom-end" width={menuWidth} withinPortal={false} returnFocus={false}>
          <PopupTooltip label={`${noun} Actions`}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`${noun} Actions`}>
                <icons.more size={18} />
              </ActionIcon>
            </Menu.Target>
          </PopupTooltip>
          <Menu.Dropdown>
            {menu && (
              <>
                {menu}
                <Menu.Divider />
              </>
            )}
            <Menu.Item
              leftSection={<icons.rename size={16} />}
              disabled={!current}
              onClick={() => naming.name("rename")}
            >
              Rename {noun}
            </Menu.Item>
            <Menu.Item
              leftSection={<icons.add size={16} />}
              disabled={!canSave}
              onClick={() => naming.name("save")}
            >
              Save as New {noun}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<icons.delete size={16} />}
              disabled={!current}
              onClick={() => current && onDelete(current)}
            >
              Delete {noun}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      {confirming && (
        <ReplaceConfirm
          message={confirming.message}
          onCancel={() => setConfirming(undefined)}
          onReplace={() => {
            setConfirming(undefined);
            onLoad(confirming.record);
          }}
        />
      )}
    </Stack>
  );
}
