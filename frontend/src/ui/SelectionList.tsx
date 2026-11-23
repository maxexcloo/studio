import { Checkbox, Divider, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { useState } from "react";

import { EmptyState } from "./EmptyState";
import { SearchInput } from "./SearchInput";

interface ChoiceGroup {
  group?: string;
  items: { value: string; label: string }[];
}

export function SelectionList({
  label,
  groups,
  value,
  onChange,
  disabled,
  max = Infinity,
  searchable = false,
  empty = "No Matches",
}: {
  label: string;
  groups: ChoiceGroup[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  max?: number;
  searchable?: boolean;
  empty?: string;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const choices = groups.flatMap(({ items }) => items);
  if (!choices.length) return <EmptyState fill>{empty}</EmptyState>;
  const shown = query
    ? groups.map(({ group, items }) => ({
        group,
        items: items.filter(({ label }) => label.toLowerCase().includes(query)),
      }))
    : groups;
  const all = value.length === choices.length;
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          {choices.length > 1 && choices.length <= max ? (
            <Checkbox
              label="Select All"
              checked={all}
              indeterminate={!all && value.length > 0}
              disabled={disabled}
              onChange={(event) =>
                onChange(event.currentTarget.checked ? choices.map(({ value }) => value) : [])
              }
            />
          ) : (
            <Text size="sm" fw={500}>
              {label}
            </Text>
          )}
          <Text size="xs" c="dimmed" aria-live="polite">
            {value.length} of {choices.length} selected
          </Text>
        </Group>
        {searchable && choices.length > 1 && (
          <SearchInput
            aria-label={`Search ${label}`}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onClear={() => setSearch("")}
          />
        )}
        <Divider />
        {shown.some(({ items }) => items.length) ? (
          <ScrollArea.Autosize mah="min(42dvh, 22rem)">
            <Checkbox.Group
              label={label}
              labelProps={{ style: { display: "none" } }}
              value={value}
              onChange={onChange}
            >
              <Stack gap="sm">
                {shown.map(({ group, items }) =>
                  items.length ? (
                    <Stack key={group ?? ""} gap="sm">
                      {group && (
                        <Text size="xs" c="dimmed" fw={500}>
                          {group}
                        </Text>
                      )}
                      {items.map(({ value: id, label }) => (
                        <Checkbox
                          key={id}
                          value={id}
                          label={label}
                          disabled={disabled || (value.length >= max && !value.includes(id))}
                        />
                      ))}
                    </Stack>
                  ) : null,
                )}
              </Stack>
            </Checkbox.Group>
          </ScrollArea.Autosize>
        ) : (
          <EmptyState>No Matches</EmptyState>
        )}
      </Stack>
    </Paper>
  );
}
