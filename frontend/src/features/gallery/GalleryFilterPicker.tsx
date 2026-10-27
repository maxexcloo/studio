import { useState } from "react";
import { SearchInput } from "../../ui/SearchInput";
import {
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
import { ChevronDown, type LucideIcon } from "lucide-react";

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
  const chosen = options
    .filter((option) => value.includes(option.value))
    .map((option) => option.label);
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
          label={`${label}: ${chosen.join(", ")}`}
          disabled={!chosen.length}
          multiline
          maw={280}
        >
          <Button
            aria-label={`Filter By ${label}`}
            aria-expanded={opened}
            variant={value.length ? "light" : "default"}
            size="compact-md"
            radius="xl"
            leftSection={<Icon size={15} />}
            rightSection={
              value.length > 0 ? (
                <Badge size="xs" circle variant="filled" aria-hidden>
                  {value.length}
                </Badge>
              ) : (
                <ChevronDown size={14} />
              )
            }
            onClick={() => {
              setQuery("");
              setOpened(!opened);
            }}
          >
            {label}
          </Button>
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
                  {query ? "No Matches" : "Nothing to Filter Yet"}
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
