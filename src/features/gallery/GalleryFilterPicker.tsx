import { useState } from "react";
import { SearchInput } from "../../ui/SearchInput";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { type LucideIcon } from "lucide-react";

export interface GalleryFilterOption {
  value: string;
  label: string;
  description?: string;
}

/** Shared multi-selection interaction for every gallery facet. */
export function GalleryFilterPicker({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  searchable = false,
  withinPortal = true,
}: {
  label: string;
  icon: LucideIcon;
  options: GalleryFilterOption[];
  value: string[];
  onChange: (value: string[]) => void;
  searchable?: boolean;
  withinPortal?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((option) =>
    terms.every((term) => option.label.toLocaleLowerCase().includes(term)),
  );
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={280}
      shadow="md"
      trapFocus
      withinPortal={withinPortal}
    >
      <Popover.Target>
        <Tooltip
          label={
            value.length
              ? `${label}: ${options
                  .filter((option) => value.includes(option.value))
                  .map((option) => option.label)
                  .join(", ")}`
              : `Filter By ${label}`
          }
        >
          <ActionIcon
            aria-label={`Filter By ${label}`}
            aria-expanded={opened}
            variant={value.length ? "light" : "subtle"}
            color={value.length ? undefined : "gray"}
            size={36}
            onClick={() => {
              setQuery("");
              setOpened(!opened);
            }}
            pos="relative"
          >
            <Icon size={19} />
            {value.length > 0 && (
              <Badge size="xs" circle pos="absolute" top={0} right={0} aria-hidden>
                {value.length}
              </Badge>
            )}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={500}>
              {label}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={!value.length}
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </Group>
          {searchable && (
            <SearchInput
              aria-label={`Search ${label}`}
              placeholder={`Search ${label.toLowerCase()}…`}
              value={query}
              onClear={() => setQuery("")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          )}
          <ScrollArea.Autosize mah={280} type="auto" offsetScrollbars>
            <Stack gap="sm" py={4}>
              {shown.map((option) => (
                <Checkbox
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  checked={value.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.currentTarget.checked
                        ? [...value, option.value]
                        : value.filter((item) => item !== option.value),
                    )
                  }
                  styles={{ label: { overflowWrap: "anywhere" } }}
                />
              ))}
              {!shown.length && (
                <Text ta="center" c="dimmed" size="sm" py="sm">
                  {query ? "No matches" : "Nothing to filter yet"}
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
