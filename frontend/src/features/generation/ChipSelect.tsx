import {
  Button,
  ColorSwatch,
  Combobox,
  type ComboboxParsedItem,
  ComboboxPopover,
  type ComboboxPopoverProps,
  Group,
  InputBase,
  ScrollArea,
  Stack,
  Text,
  defaultOptionsFilter,
  getParsedComboboxData,
  isOptionsGroup,
  useCombobox,
  useComboboxTargetProps,
} from "@mantine/core";
import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";

import { popupMiddlewares } from "../../theme";
import { SearchInput } from "../../ui/SearchInput";
import { useTouch } from "../../ui/usePhone";
import { chipProps } from "./chip";

import classes from "./GenerationInputControls.module.css";

export type ChipSelectProps = Pick<
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
  field?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  withinPortal?: boolean;
};

/**
 * A rail chip that opens its option list: the composer's Profile. `swatch`
 * is a readiness colour beside the name; `target` adds attributes to the chip itself. On touch
 * screens the search waits for a tap; desktop opening focuses it for keyboard navigation. A
 * `field` trigger is a select field instead, filling a Settings row. The list fits the screen,
 * scrolling inside when it is taller.
 */
export function ChipSelect({
  name,
  label,
  swatch,
  title,
  target,
  field = false,
  clearable = false,
  disabled,
  searchable,
  data,
  value,
  onChange,
  dropdownOpened,
  onDropdownOpen,
  onDropdownClose,
  nothingFoundMessage,
  renderOption,
  withinPortal = true,
}: ChipSelectProps) {
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
  const swatchDot = swatch && (
    <ColorSwatch
      component="span"
      size={8}
      withShadow={false}
      color={`var(--mantine-color-${swatch}-6)`}
      aria-hidden
    />
  );
  const canClear = clearable && Boolean(value) && !disabled;
  return (
    <Combobox
      store={combobox}
      returnFocus
      width="min(var(--studio-popup-width), 100vw - 32px)"
      position={field ? "bottom-end" : "top-start"}
      middlewares={{ ...popupMiddlewares, size: { padding: 12 } }}
      classNames={{ dropdown: classes.fittedList }}
      withinPortal={withinPortal}
      onOptionSubmit={(selected) => {
        onChange?.(selected);
        combobox.closeDropdown();
        setSearch("");
      }}
    >
      <ComboboxPopover.Target>
        {field ? (
          <InputBase
            component="button"
            type="button"
            pointer
            aria-label={name}
            disabled={disabled}
            {...target}
            leftSection={swatchDot}
            rightSection={
              canClear ? (
                <Combobox.ClearButton
                  aria-label={`Clear ${name}`}
                  aria-hidden={false}
                  tabIndex={0}
                  onClear={() => {
                    onChange?.(null);
                    combobox.closeDropdown();
                    combobox.focusTarget();
                  }}
                />
              ) : (
                <ChevronDown size={16} />
              )
            }
            rightSectionPointerEvents={canClear ? "all" : "none"}
            title={title}
          >
            <Text
              span
              inherit
              c={clearable && !value ? "var(--input-placeholder-color)" : undefined}
              className={classes.fieldLabel}
            >
              {label}
            </Text>
          </InputBase>
        ) : (
          <Button
            aria-label={name}
            disabled={disabled}
            {...chipProps}
            {...target}
            leftSection={swatchDot}
            rightSection={<ChevronDown size={14} />}
            title={title}
          >
            <span className={classes.label}>{label}</span>
          </Button>
        )}
      </ComboboxPopover.Target>
      <Combobox.Dropdown>
        {searchable && (
          <OptionSearch
            ref={combobox.searchRef}
            aria-label={`Search ${name}`}
            value={search}
            onSearch={(value) => {
              setSearch(value);
              combobox.resetSelectedOption();
            }}
          />
        )}
        <ScrollArea.Autosize mah={320} mih={0} type="scroll">
          <Combobox.Options>
            {options.map(render)}
            {empty && nothingFoundMessage && <Combobox.Empty>{nothingFoundMessage}</Combobox.Empty>}
          </Combobox.Options>
        </ScrollArea.Autosize>
      </Combobox.Dropdown>
    </Combobox>
  );
}

/** The shared search field at the top of a chip's list, moving through its options by keyboard. */
function OptionSearch({
  value,
  onSearch,
  ...props
}: {
  "aria-label": string;
  value: string;
  onSearch: (value: string) => void;
  ref: Ref<HTMLInputElement>;
}) {
  const keyboard = useComboboxTargetProps({
    targetType: "input",
    withAriaAttributes: true,
    withKeyboardNavigation: true,
    withExpandedAttribute: false,
    autoComplete: "off",
    onKeyDown: undefined,
    onClick: undefined,
  });
  return (
    <SearchInput
      {...keyboard}
      {...props}
      m={4}
      value={value}
      onChange={(event) => onSearch(event.currentTarget.value)}
      onClear={() => onSearch("")}
    />
  );
}

/** One ChipSelect option: its name with any badges after it, its description, and a check when chosen. */
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
        <Group gap={4} wrap="nowrap" miw={0}>
          <Text size="sm" fw={500} truncate title={label}>
            {label}
          </Text>
          {badges}
        </Group>
        {description && (
          <Text size="xs" c="dimmed" truncate title={description}>
            {description}
          </Text>
        )}
      </Stack>
      {checked && <Check size={14} style={{ flexShrink: 0 }} />}
    </Group>
  );
}
