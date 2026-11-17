import {
  Button,
  ColorSwatch,
  Combobox,
  type ComboboxParsedItem,
  ComboboxPopover,
  type ComboboxPopoverProps,
  Group,
  ScrollArea,
  Stack,
  Text,
  defaultOptionsFilter,
  getParsedComboboxData,
  isOptionsGroup,
  useCombobox,
} from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useTouch } from "../../ui/usePhone";
import { chipProps } from "./chip";

import classes from "./GenerationInputControls.module.css";

/**
 * A rail chip that opens its option list: the composer's Profile. `swatch`
 * is a readiness colour beside the name; `target` adds attributes to the chip itself. On touch
 * screens the search waits for a tap; desktop opening focuses it for keyboard navigation.
 */
export function ChipSelect({
  name,
  label,
  swatch,
  title,
  target,
  searchable,
  data,
  value,
  onChange,
  dropdownOpened,
  onDropdownOpen,
  onDropdownClose,
  nothingFoundMessage,
  renderOption,
}: Pick<
  ComboboxPopoverProps,
  | "data"
  | "value"
  | "onChange"
  | "dropdownOpened"
  | "onDropdownOpen"
  | "onDropdownClose"
  | "nothingFoundMessage"
  | "renderOption"
  | "searchable"
> & {
  name: string;
  label: ReactNode;
  swatch?: string;
  title?: string;
  target?: Record<string, unknown>;
}) {
  const touch = useTouch();
  const [search, setSearch] = useState("");
  const combobox = useCombobox({
    opened: dropdownOpened,
    onDropdownOpen: () => {
      onDropdownOpen?.();
      if (searchable && !touch) combobox.focusSearchInput();
    },
    onDropdownClose: () => {
      onDropdownClose?.();
      combobox.resetSelectedOption();
      setSearch("");
    },
  });
  const options = defaultOptionsFilter({
    options: getParsedComboboxData(data),
    search: searchable ? search : "",
    limit: Infinity,
  }) as ComboboxParsedItem[];
  const empty = options.every((option) => isOptionsGroup(option) && !option.items.length);
  const render = (option: ComboboxParsedItem): ReactNode =>
    isOptionsGroup(option) ? (
      <Combobox.Group key={String(option.group)} label={option.group}>
        {option.items.map(render)}
      </Combobox.Group>
    ) : (
      <Combobox.Option
        key={option.value}
        value={option.value}
        disabled={option.disabled}
        active={option.value === value}
        aria-selected={option.value === value}
      >
        {renderOption ? renderOption({ option, checked: option.value === value }) : option.label}
      </Combobox.Option>
    );
  return (
    <Combobox
      store={combobox}
      returnFocus
      width="min(440px, 100vw - 32px)"
      position="top-start"
      withinPortal
      onOptionSubmit={(selected) => {
        onChange?.(selected);
        combobox.closeDropdown();
        setSearch("");
      }}
    >
      <ComboboxPopover.Target>
        <Button
          aria-label={name}
          {...chipProps}
          {...target}
          leftSection={
            swatch && (
              <ColorSwatch
                component="span"
                size={8}
                withShadow={false}
                color={`var(--mantine-color-${swatch}-6)`}
                aria-hidden
              />
            )
          }
          rightSection={<ChevronDown size={14} />}
          title={title}
        >
          <span className={classes.label}>{label}</span>
        </Button>
      </ComboboxPopover.Target>
      <Combobox.Dropdown>
        {searchable && (
          <Combobox.Search
            aria-label={`Search ${name}`}
            placeholder="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              combobox.resetSelectedOption();
            }}
          />
        )}
        <ScrollArea.Autosize mah={320} type="scroll">
          <Combobox.Options>
            {options.map(render)}
            {empty && nothingFoundMessage && <Combobox.Empty>{nothingFoundMessage}</Combobox.Empty>}
          </Combobox.Options>
        </ScrollArea.Autosize>
      </Combobox.Dropdown>
    </Combobox>
  );
}

/** One ChipSelect option: its name and description, with badges at the trailing edge. */
export function ChipOption({
  label,
  description,
  checked,
  badges,
}: {
  label: string;
  description?: string;
  checked?: boolean;
  badges?: ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" w="100%">
      <Stack gap={0} miw={0}>
        <Text size="sm" fw={checked ? 600 : 500} truncate title={label}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed" truncate title={description}>
            {description}
          </Text>
        )}
      </Stack>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {badges}
      </Group>
    </Group>
  );
}
