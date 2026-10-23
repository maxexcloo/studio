import { forwardRef, useRef } from "react";
import { ActionIcon, Group, TextInput, type TextInputProps } from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { ArrowLeft, Search, X } from "lucide-react";

export interface SearchInputProps extends Omit<TextInputProps, "rightSection"> {
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
  const controls = Number(hasQuery);
  return (
    <TextInput
      {...props}
      value={value}
      ref={ref}
      leftSection={
        onClose ? (
          <ActionIcon
            aria-label="Close Search"
            variant="subtle"
            color="gray"
            size={30}
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </ActionIcon>
        ) : (
          (leftSection ?? <Search size={16} />)
        )
      }
      leftSectionPointerEvents={onClose ? "all" : undefined}
      rightSectionWidth={controls ? controls * 30 + 8 : undefined}
      rightSection={
        controls ? (
          <Group gap={0} wrap="nowrap">
            {hasQuery && (
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
                <X size={16} />
              </ActionIcon>
            )}
          </Group>
        ) : undefined
      }
    />
  );
});
