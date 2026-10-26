import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tooltip,
} from "@mantine/core";
import { Search, SlidersHorizontal } from "lucide-react";
import { SearchInput } from "./SearchInput";
import { usePhone } from "./usePhone";
import classes from "./SectionToolbar.module.css";

/**
 * Library and Settings lists share one toolbar: segmented views on the left, then an expanding
 * search, one filter popover and the section's own actions. Escape closes search, keeping the query,
 * or the filters; `data-mantine-stop-propagation` keeps that Escape from also closing the modal.
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
  onResetFilters,
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
  onResetFilters?: () => void;
  actions?: ReactNode;
}) {
  const phone = usePhone();
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);
  const close = () => {
    setSearching(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  if (searching && onQueryChange)
    return (
      <Group className={classes.enter} mih={44} wrap="nowrap">
        <SearchInput
          ref={input}
          aria-label={`Search ${label}`}
          placeholder={`Search ${label}…`}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onClear={() => onQueryChange("")}
          onClose={close}
          data-mantine-stop-propagation
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          w="100%"
        />
      </Group>
    );
  return (
    <Group className={classes.enter} gap="xs" mih={44} wrap="nowrap">
      {views && (
        <SegmentedControl
          aria-label={`${label} View`}
          size={phone ? "xs" : "sm"}
          radius="xl"
          data={views}
          value={view}
          onChange={onViewChange}
          className={classes.views}
        />
      )}
      <Group gap={4} ml="auto" wrap="nowrap">
        {onQueryChange && (
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
        )}
        {filters && (
          <Popover position="bottom-end" width={300} trapFocus>
            <Popover.Target>
              <Tooltip label={`Filter ${label}`}>
                <ActionIcon
                  aria-label={`Filter ${label}`}
                  variant={filterCount ? "light" : "subtle"}
                  color={filterCount ? undefined : "gray"}
                  pos="relative"
                >
                  <SlidersHorizontal size={18} />
                  {filterCount > 0 && (
                    <Badge size="xs" circle pos="absolute" top={0} right={0} aria-hidden>
                      {filterCount}
                    </Badge>
                  )}
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown aria-label={`${label} Filters`} role="dialog" p="sm">
              <ScrollArea.Autosize mah="min(60dvh, 420px)">
                <Stack gap="sm">
                  {filters}
                  <Button
                    data-mantine-stop-propagation
                    variant="subtle"
                    size="compact-sm"
                    onClick={onResetFilters}
                    style={{ alignSelf: "end" }}
                  >
                    Reset Filters
                  </Button>
                </Stack>
              </ScrollArea.Autosize>
            </Popover.Dropdown>
          </Popover>
        )}
        {actions}
      </Group>
    </Group>
  );
}
