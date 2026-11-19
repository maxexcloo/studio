import {
  ActionIcon,
  Badge,
  Button,
  Chip,
  Divider,
  Group,
  Input,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Check, ChevronDown, type LucideIcon, Search } from "lucide-react";
import { type ComponentPropsWithRef, type ReactNode, useEffect, useRef, useState } from "react";

import { menuWidth } from "../theme";
import { ClearButton } from "./ClearButton";
import { DialogFooter } from "./ConfirmDialog";
import { icons } from "./icons";
import { PopupTooltip } from "./PopupTooltip";
import { ScrollingSegments } from "./ScrollingSegments";
import { SearchInput } from "./SearchInput";
import { usePhone } from "./usePhone";

import classes from "./SectionToolbar.module.css";

/** A section's heading (from `WorkspaceSections`) with its toolbar beside it. */
export function SectionHeader({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <div className={classes.header}>
      {heading}
      <div>{children}</div>
    </div>
  );
}

/**
 * A section's create or primary action at the end of its toolbar: filled and labelled on desktop,
 * its icon alone on phones (with ▾ where it opens a menu), as the toolbar's other icons. It passes
 * other props on, so it can be a menu's target.
 */
export function ToolbarAction({
  label,
  icon: Icon,
  href,
  rightSection,
  variant,
  ...props
}: { label: string; icon: LucideIcon; href?: string } & Omit<
  ComponentPropsWithRef<typeof Button<"button">>,
  "children"
>) {
  const phone = usePhone();
  const renderLink =
    href && ((props: ComponentPropsWithRef<"a">) => <a {...props} href={href} download />);
  if (phone)
    return (
      <Tooltip label={label}>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={label}
          w={rightSection ? "auto" : undefined}
          px={rightSection ? 4 : undefined}
          renderRoot={renderLink || undefined}
          {...(props as ComponentPropsWithRef<typeof ActionIcon<"button">>)}
        >
          <Icon size={18} />
          {rightSection && <ChevronDown size={12} />}
        </ActionIcon>
      </Tooltip>
    );
  return (
    <Button
      size="compact-sm"
      leftSection={<Icon size={16} />}
      rightSection={rightSection}
      variant={variant}
      renderRoot={renderLink || undefined}
      {...props}
    >
      {label}
    </Button>
  );
}

/** On phones a toolbar's views are a menu named by the current one (Installed ▾). */
function ViewMenu({
  label,
  views,
  view,
  onViewChange,
}: {
  label: string;
  views: { value: string; label: string }[];
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  return (
    <Menu position="bottom-end" width={menuWidth}>
      <Menu.Target>
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          aria-label={`${label} View`}
          rightSection={<ChevronDown size={12} />}
        >
          {views.find((item) => item.value === view)?.label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {views.map((item) => (
          <Menu.Item
            key={item.value}
            rightSection={item.value === view ? <Check size={14} /> : undefined}
            onClick={() => onViewChange?.(item.value)}
          >
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Separates a toolbar's groups of actions, as in the viewer and selection bars. */
function ToolbarDivider() {
  return <Divider orientation="vertical" className={classes.divider} />;
}

/** A section's secondary action, listed by name under its toolbar's More menu. */
interface ToolbarMoreAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** A download link instead of a click. */
  href?: string;
}

const link = (href?: string) => (href ? { component: "a" as const, href, download: true } : {});

/**
 * One filter's choices, inline in a toolbar's Filter popover: All, then each option; exactly one
 * is chosen, and All (`null`) filters nothing.
 */
export function FilterChoices({
  label,
  data,
  value,
  onChange,
}: {
  label: string;
  data: (string | { value: string; label: string })[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const options = data.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return (
    <Input.Wrapper label={label} labelElement="div">
      <Chip.Group value={value ?? ""} onChange={(next) => onChange(next || null)}>
        <Group gap={6} mt={4} role="radiogroup" aria-label={label}>
          {[{ value: "", label: "All" }, ...options].map((option) => (
            <Chip key={option.value} value={option.value} size="xs" variant="light">
              {option.label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </Input.Wrapper>
  );
}

/**
 * Library and Settings lists share one toolbar, on one line: segmented views (on phones a menu
 * named by the current view), then search (a field, or on phones an icon that expands into one
 * across the header), one filter popover, then behind a divider the section's own actions: `more`
 * by name under ⋯, then `actions`, ending with the create action (`ToolbarAction`). Escape leaves search, keeping the query, or closes the filters;
 * `data-mantine-stop-propagation` keeps that Escape from also closing the modal.
 */
export function SectionToolbar({
  label,
  views,
  view,
  onViewChange,
  query,
  onQueryChange,
  filters,
  filterCount = 0,
  onClearFilters,
  more = [],
  actions,
}: {
  label: string;
  views?: { value: string; label: string }[];
  view?: string;
  onViewChange?: (value: string) => void;
  query?: string;
  onQueryChange?: (value: string) => void;
  filters?: ReactNode;
  filterCount?: number;
  onClearFilters?: () => void;
  more?: ToolbarMoreAction[];
  actions?: ReactNode;
}) {
  const phone = usePhone();
  const [searching, setSearching] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);
  const close = () => {
    setSearching(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const search = (expanded: boolean) =>
    onQueryChange && (
      <SearchInput
        ref={input}
        aria-label={`Search ${label}`}
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
        onClose={expanded ? close : undefined}
        data-mantine-stop-propagation
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (expanded) close();
          else event.currentTarget.blur();
        }}
        size="sm"
        radius="xl"
        w={expanded ? "100%" : "13rem"}
      />
    );
  const segments =
    views &&
    (phone ? (
      <ViewMenu label={label} views={views} view={view} onViewChange={onViewChange} />
    ) : (
      <ScrollingSegments
        aria-label={`${label} View`}
        radius="xl"
        data={views}
        value={view}
        onChange={onViewChange}
      />
    ));
  // A phone's open search takes the header's full width, under the description.
  if (searching && phone && onQueryChange)
    return (
      <Group className={`${classes.enter} ${classes.searching}`} gap="xs" mih={44}>
        {search(true)}
      </Group>
    );
  return (
    <Group className={classes.enter} gap="xs" mih={44} wrap="nowrap" justify="flex-end">
      {segments}
      <Group gap={4} wrap="nowrap">
        {onQueryChange &&
          (phone ? (
            <Tooltip label={`Search ${label}`}>
              <ActionIcon
                ref={trigger}
                aria-label={`Search ${label}`}
                variant={query ? "light" : "subtle"}
                color={query ? undefined : "gray"}
                onClick={() => setSearching(true)}
              >
                <Search size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            search(false)
          ))}
        {filters && (
          <Popover
            position="bottom-end"
            width={300}
            trapFocus
            opened={filtering}
            onChange={setFiltering}
          >
            {/* The Tooltip wraps the target, so the button itself carries aria-expanded. */}
            <PopupTooltip label={`Filter ${label}`}>
              <Popover.Target>
                <ActionIcon
                  aria-label={`Filter ${label}`}
                  variant={filterCount ? "light" : "subtle"}
                  color={filterCount ? undefined : "gray"}
                  pos="relative"
                  onClick={() => setFiltering(!filtering)}
                >
                  <icons.filter size={18} />
                  {filterCount > 0 && (
                    <Badge
                      size="xs"
                      circle
                      variant="filled"
                      pos="absolute"
                      top={0}
                      right={0}
                      aria-hidden
                    >
                      {filterCount}
                    </Badge>
                  )}
                </ActionIcon>
              </Popover.Target>
            </PopupTooltip>
            <Popover.Dropdown
              aria-label={`${label} Filters`}
              role="dialog"
              p="sm"
              onFocusCapture={(event) =>
                event.target.setAttribute("data-mantine-stop-propagation", "true")
              }
            >
              <ScrollArea.Autosize mah="min(60dvh, 420px)">
                {/* Titled and ended with ✕ and Done, as the gallery's and the pickers' Filters are. */}
                <Stack gap="sm">
                  <Text fw={500} mih={28}>
                    Filters
                  </Text>
                  {filters}
                  <DialogFooter>
                    {onClearFilters && (
                      <ClearButton disabled={!filterCount} onClear={onClearFilters} />
                    )}
                    <Button onClick={() => setFiltering(false)}>Done</Button>
                  </DialogFooter>
                </Stack>
              </ScrollArea.Autosize>
            </Popover.Dropdown>
          </Popover>
        )}
        {(onQueryChange || filters) && more.length > 0 && <ToolbarDivider />}
        {more.length > 0 && (
          <Menu position="bottom-end" width={menuWidth}>
            <PopupTooltip label={`More ${label} Actions`}>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`More ${label} Actions`}>
                  <icons.more size={18} />
                </ActionIcon>
              </Menu.Target>
            </PopupTooltip>
            <Menu.Dropdown>
              {more.map((action) => (
                <Menu.Item
                  key={action.label}
                  leftSection={<action.icon size={16} />}
                  onClick={action.onClick}
                  {...link(action.href)}
                >
                  {action.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
        {actions && (
          <Group gap={phone ? 4 : "xs"} ml={phone ? 0 : "xs"} wrap="nowrap">
            {actions}
          </Group>
        )}
      </Group>
    </Group>
  );
}
