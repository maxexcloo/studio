import { ActionIcon, TextInput, type TextInputProps } from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { ArrowLeft, Search } from "lucide-react";
import { forwardRef, useRef } from "react";

import { icons } from "./icons";

interface SearchInputProps extends Omit<TextInputProps, "rightSection"> {
  onClear: () => void;
  onClose?: () => void;
}

/** Search fields share explicit query clearing without altering selected values. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onClear, onClose, leftSection, ...props },
  forwardedRef,
) {
  const input = useRef<HTMLInputElement>(null);
  const ref = useMergedRef(input, forwardedRef);
  const hasQuery = String(value ?? "").length > 0;
  return (
    <TextInput
      placeholder="Search"
      {...props}
      value={value}
      ref={ref}
      leftSection={
        onClose ? (
          <ActionIcon aria-label="Close Search" variant="subtle" color="gray" onClick={onClose}>
            <ArrowLeft size={18} />
          </ActionIcon>
        ) : (
          (leftSection ?? <Search size={16} />)
        )
      }
      leftSectionPointerEvents={onClose ? "all" : undefined}
      rightSection={
        hasQuery && (
          <ActionIcon
            aria-label="Clear Search"
            variant="subtle"
            color="gray"
            size={30}
            onClick={() => {
              onClear();
              input.current?.focus();
            }}
          >
            <icons.clear size={16} />
          </ActionIcon>
        )
      }
    />
  );
});
