import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { type LucideIcon, Search } from "lucide-react";
import { type ComponentPropsWithRef, type ReactNode, useEffect, useRef, useState } from "react";

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
 * A section's create or primary action: filled and labelled, at the end of its toolbar. It passes
 * other props on, so it can be a menu's target.
 */
export function ToolbarAction({
  label,
  icon: Icon,
  ...props
}: { label: string; icon: LucideIcon } & Omit<
  ComponentPropsWithRef<typeof Button<"button">>,
  "children"
>) {
  return (
    <Button size="compact-sm" leftSection={<Icon size={16} />} {...props}>
      {label}
    </Button>
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
 * Library and Settings lists share one toolbar: segmented views on the left, then search (a field,
 * or on phones an icon that expands into one), one filter popover, then behind a divider the
 * section's own actions: `more` by name under ⋯, then `actions`, ending with the filled create
 * action. Escape leaves search, keeping the query, or closes the filters;
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
  if (searching && phone && onQueryChange)
    return (
      <Group className={classes.enter} mih={44} wrap="nowrap">
        {search(true)}
      </Group>
    );
  return (
    <Group className={classes.enter} gap="xs" mih={44} wrap="nowrap">
      {views && (
        <ScrollingSegments
          aria-label={`${label} View`}
          size={phone ? "xs" : "sm"}
          radius="xl"
          data={views}
          value={view}
          onChange={onViewChange}
        />
      )}
      <Group gap={4} ml="auto" wrap="nowrap">
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
          <Menu position="bottom-end">
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
          <Group gap="xs" ml="xs" wrap="nowrap">
            {actions}
          </Group>
        )}
      </Group>
    </Group>
  );
}
