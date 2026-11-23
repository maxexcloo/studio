import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Combobox,
  FileButton,
  Group,
  Image,
  InputBase,
  Loader,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
  getDefaultZIndex,
  useCombobox,
} from "@mantine/core";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { menuWidth } from "../../theme";
import { ChipPopup } from "../../ui/ChipPopup";
import { compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { ScrollingSegments } from "../../ui/ScrollingSegments";
import { SearchInput } from "../../ui/SearchInput";
import { useFlash } from "../../ui/useFlash";
import { usePhone, useTouch } from "../../ui/usePhone";
import { chipProps, iconChipProps } from "./chip";
import { uploadTypes } from "./references";

import classes from "./Picker.module.css";

/**
 * The References and LoRA pickers share one header, tile, grid and footer, so tabs, search,
 * filters, selection and actions look and behave the same in both and on every breakpoint.
 */

/** Start a phone picker on Add when opened with an empty stack. */
export function usePickerChoices(opened: boolean, empty: boolean) {
  const [wasOpened, setWasOpened] = useState(opened);
  const [adding, setAdding] = useState(opened && empty);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    setAdding(opened && empty);
  }
  return [adding, setAdding] as const;
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
            className={classes.tabs}
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
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onClear={() => onQueryChange("")}
          />
          {filters && (
            <ChipPopup
              title="Filters"
              spacious={false}
              opened={filtering}
              onOpenedChange={setFiltering}
              position="bottom-end"
              withinPortal={false}
              onClear={onClearFilters}
              clearDisabled={!filterCount}
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

/** The first tile of a picker's Uploads: chooses image files to upload, named by `label`. */
export function UploadTile({
  label,
  disabled,
  loading,
  onFiles,
}: {
  label: string;
  disabled: boolean;
  loading: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <FileButton accept={uploadTypes.join(",")} multiple onChange={onFiles}>
      {({ onClick }) => (
        <PickerTile
          label={label}
          title="Upload"
          placeholder={icons.upload}
          disabled={disabled}
          loading={loading}
          onToggle={onClick}
        />
      )}
    </FileButton>
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
  loading = false,
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
  selected?: boolean;
  onToggle: () => void;
  disabled?: boolean;
  loading?: boolean;
  image?: string;
  placeholder?: LucideIcon;
  /** The picture's aspect ratio, such as "4 / 3". */
  aspect?: string;
  title?: string;
  detail?: string;
  /** A corner control such as a LoRA's rating or Delete. */
  action?: ReactNode;
  drag?: [type: string, data: string];
  /** The image's `aspect` reserves its size while it loads. */
  preview?: {
    label: string;
    open: () => void;
    image?: { src: string; alt: string; aspect?: string };
  };
  row?: boolean;
}) {
  // Mantine omits target IDs withRoles=false; outside presses still need the preview's target.
  const previewId = useId();
  const [state, setState] = useState<"loaded" | "failed">();
  const peekable = !useTouch() && Boolean(preview?.image);
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef(0);
  const openedAt = useRef("");
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
      id={previewId}
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
          id={previewId}
          className={classes.tile}
          role="listitem"
          data-row={row || undefined}
          data-selected={selected || undefined}
        >
          <UnstyledButton
            className={classes.toggle}
            aria-label={label}
            aria-pressed={selected}
            aria-busy={loading || undefined}
            disabled={loading || (disabled && !selected)}
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
              {loading ? (
                <Loader size="sm" />
              ) : (
                Placeholder && <Placeholder size={row ? 18 : 22} aria-hidden />
              )}
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
                    // The pointer still resting where it opened the preview does not peek as it closes.
                    onMouseEnter={(event) =>
                      peekable &&
                      `${event.clientX},${event.clientY}` !== openedAt.current &&
                      hover(true)
                    }
                    onMouseLeave={() => hover(false)}
                    onClick={(event) => {
                      openedAt.current = `${event.clientX},${event.clientY}`;
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
          <Image
            src={preview.image.src}
            alt={preview.image.alt}
            radius="sm"
            style={{ aspectRatio: preview.image.aspect }}
          />
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

interface SavedItem {
  id: string;
  name: string;
  /** When it was saved; older records without one sort by their place in the list. */
  savedAt?: string;
  /** A note under the name, such as where an older record came from. */
  detail?: string;
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
    <Group
      className={`${classes.reveal} ${classes.confirm}`}
      justify="space-between"
      gap="xs"
      p="xs"
    >
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

/** Names a saved record and announces successful changes. */
export function useNaming() {
  const [naming, setNaming] = useState<"rename" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [saved, flashSaved] = useFlash();
  /** Focuses the name field to rename the current record. */
  const name = (mode: "rename" | null) => {
    setNaming(mode);
    if (mode) setTimeout(() => field.current?.focus());
  };
  return { naming, name, field, saved, flashSaved };
}
type Naming = ReturnType<typeof useNaming>;
/** A failed save shows the shared mutation notification; the field just stays as it is. */
const ignore = () => {};

/**
 * A saved record's name as a combobox, for a popup heading's `name`: it shows the current record's
 * name, or Unsaved. Its list loads a saved record, asking first, under the heading, where
 * `replaces` says what it would replace; typing searches the list or names the draft to save it as
 * new or rename the current record. Names stay unique; duplicates from before show when each was
 * saved. The current record can be updated from the list. Its menu holds `menu` (such as what
 * a preset saves), then Rename and Delete.
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
  onUpdate,
  onRename,
  onDelete,
}: {
  noun: string;
  naming: Naming;
  records: T[];
  current?: T;
  edited: boolean;
  /** Whether the draft holds anything to save, and the saved records have loaded. */
  canSave: boolean;
  /** What loading `record` asks first, or nothing when the draft has nothing unsaved. */
  replaces: (record: T) => string | undefined;
  menu?: ReactNode;
  onLoad: (record: T) => void;
  onSave: (name: string) => Promise<unknown>;
  onUpdate: (record: T) => Promise<unknown>;
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
        .sort((a, b) => compareNames(a.name, b.name));
  const actions: { value: string; label: string }[] = [];
  if (current && edited && canSave && !typed && !mode)
    actions.push({ value: "\0update", label: `Update ${noun}` });
  if (typed && !taken) {
    if (!mode && canSave)
      actions.push({ value: "\0save", label: `Save as New ${noun} “${typed}”` });
    if (current) actions.push({ value: "\0rename", label: `Rename to “${typed}”` });
  }
  const empty = mode
    ? typed
      ? "Name in Use"
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
    if (value === "\0update") {
      if (current) await onUpdate(current).then(() => naming.flashSaved(true), ignore);
      return;
    }
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
  return (
    <>
      <Group gap="xs" wrap="nowrap" flex="1 1 0" miw={0}>
        {/* The list outgrows the field, which shares its heading's row. */}
        <Combobox
          store={combobox}
          withinPortal={false}
          width={menuWidth}
          position="bottom-start"
          onOptionSubmit={submit}
        >
          <Combobox.Target withExpandedAttribute>
            <InputBase
              ref={naming.field}
              size="sm"
              flex={1}
              miw={0}
              classNames={{ input: classes.nameInput }}
              aria-label={`${noun} Name`}
              placeholder={`Unsaved ${noun}`}
              value={text ?? current?.name ?? ""}
              data-mantine-stop-propagation
              rightSection={<Combobox.Chevron />}
              rightSectionPointerEvents="none"
              onClick={() => combobox.openDropdown()}
              onFocus={(event) => {
                event.currentTarget.select();
                if (mode) combobox.openDropdown();
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
                        <Text size="sm" truncate>
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
        <VisuallyHidden role="status">{naming.saved ? "Saved" : ""}</VisuallyHidden>
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
              Rename
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<icons.delete size={16} />}
              disabled={!current}
              onClick={() => current && onDelete(current)}
            >
              Delete
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
    </>
  );
}
