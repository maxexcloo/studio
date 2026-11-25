import { ActionIcon, Badge, Button, Chip, Group, Input, Stack, Tooltip } from "@mantine/core";
import { ChevronDown, type LucideIcon, Search } from "lucide-react";
import {
  type AnimationEvent,
  type ComponentPropsWithRef,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ChipPopup } from "./ChipPopup";
import { icons } from "./icons";
import { ScrollingSegments } from "./ScrollingSegments";
import { SearchInput } from "./SearchInput";
import { usePhone } from "./usePhone";
import { ViewMenu } from "./ViewMenu";

import classes from "./SectionToolbar.module.css";

/** A section's heading (from `WorkspaceSections`) with its toolbar beside it. */
export function SectionHeader({
  heading,
  children,
  singleLine,
}: {
  heading: ReactNode;
  children: ReactNode;
  singleLine?: boolean;
}) {
  return (
    <div className={singleLine ? `${classes.header} ${classes.singleLine}` : classes.header}>
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
  iconOnly,
  href,
  rightSection,
  variant,
  ...props
}: { label: string; icon: LucideIcon; iconOnly?: boolean; href?: string } & Omit<
  ComponentPropsWithRef<typeof Button<"button">>,
  "children"
>) {
  const phone = usePhone();
  const renderLink =
    href && ((props: ComponentPropsWithRef<"a">) => <a {...props} href={href} download />);
  if (phone || iconOnly)
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
 * named by the current view), then search (a field, or an icon when space is tight),
 * one filter popover, then the section's own `actions`, ending with the create action
 * (`ToolbarAction`). Escape leaves search, keeping the query, or closes the filters;
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
  actions?: ReactNode;
}) {
  const phone = usePhone();
  const [searching, setSearching] = useState(false);
  // Only swapping the toolbar and its search fades, not a section's first or later reveal.
  const [swapped, setSwapped] = useState(false);
  const swap = (next: boolean) => {
    setSearching(next);
    setSwapped(true);
  };
  const enter = swapped ? classes.enter : undefined;
  const entered = (event: AnimationEvent) => {
    if (event.target === event.currentTarget) setSwapped(false);
  };
  const [filtering, setFiltering] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);
  const close = () => {
    swap(false);
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
        className={expanded ? classes.expandedSearch : classes.inlineSearch}
      />
    );
  const segments =
    views &&
    (phone ? (
      <ViewMenu
        label={`${label} View`}
        value={view ?? ""}
        groups={[views]}
        onChange={(value) => onViewChange?.(value)}
      />
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
      <Group
        className={`${enter ?? ""} ${classes.searching}`}
        gap="xs"
        mih={44}
        onAnimationEnd={entered}
      >
        {search(true)}
      </Group>
    );
  return (
    <Group
      className={enter}
      onAnimationEnd={entered}
      data-adaptive-search={phone && !views && onQueryChange ? "" : undefined}
      gap="xs"
      mih={44}
      wrap="nowrap"
      justify="flex-end"
    >
      {segments}
      <Group className={classes.controls} gap={4} wrap="nowrap">
        {(!phone || !views) && search(false)}
        {phone && onQueryChange && (
          <Tooltip label={`Search ${label}`}>
            <ActionIcon
              className={classes.searchTrigger}
              ref={trigger}
              aria-label={`Search ${label}`}
              variant={query ? "light" : "subtle"}
              color={query ? undefined : "gray"}
              onClick={() => swap(true)}
            >
              <Search size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {filters && (
          <ChipPopup
            title={`Filter ${label}`}
            tooltip
            floating
            opened={filtering}
            onOpenedChange={setFiltering}
            position="bottom-end"
            onClear={onClearFilters}
            clearDisabled={!filterCount}
            target={
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
            }
          >
            <Stack gap="sm">{filters}</Stack>
          </ChipPopup>
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
