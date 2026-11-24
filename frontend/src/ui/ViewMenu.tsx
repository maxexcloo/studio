import { Button, Group, Menu, Text } from "@mantine/core";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, type Ref } from "react";

import { menuWidth } from "../theme";
import { PopupTooltip } from "./PopupTooltip";
import { usePhone } from "./usePhone";

import classes from "./ViewMenu.module.css";

export function ViewMenu<T extends string>({
  label,
  value,
  groups,
  actions = [],
  onChange,
  onOpen,
  describedBy,
  ref,
}: {
  label: string;
  value: T;
  groups: readonly (readonly {
    value: T;
    label: string;
    disabled?: boolean;
    /** How many items the view holds, once known. */
    count?: number;
  }[])[];
  /** Actions on the views, after a divider: saving the one shown, say. */
  actions?: { label: string; disabled?: boolean; onClick: () => void }[];
  onChange: (value: T) => void;
  describedBy?: string;
  /** Runs as the menu opens, so counts load only once wanted. */
  onOpen?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const phone = usePhone();
  const current = groups.flat().find((choice) => choice.value === value);
  return (
    <Menu position="bottom-start" width={menuWidth} onOpen={onOpen}>
      <PopupTooltip label={label}>
        <Menu.Target>
          <Button
            ref={ref}
            size={phone ? "compact-sm" : "compact-md"}
            variant="subtle"
            color="gray"
            aria-label={label}
            aria-describedby={describedBy}
            rightSection={<ChevronDown size={14} />}
          >
            <span className={classes.labels}>
              <span>{current?.label}</span>
              {groups.flat().map((choice) => (
                <span key={choice.value} data-label={choice.label} />
              ))}
            </span>
          </Button>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        {groups.map((choices, index) => (
          <Fragment key={index}>
            {index > 0 && <Menu.Divider />}
            {choices.map((choice) => (
              <Menu.Item
                key={choice.value}
                aria-label={choice.label}
                disabled={choice.disabled}
                rightSection={
                  <Group gap="xs" wrap="nowrap">
                    {choice.count !== undefined && (
                      <Text size="xs" c="dimmed" className={classes.count}>
                        {choice.count.toLocaleString()}
                      </Text>
                    )}
                    <Check size={14} visibility={choice.value === value ? undefined : "hidden"} />
                  </Group>
                }
                onClick={() => onChange(choice.value)}
              >
                {choice.label}
              </Menu.Item>
            ))}
          </Fragment>
        ))}
        {actions.length > 0 && <Menu.Divider />}
        {actions.map((action) => (
          <Menu.Item key={action.label} disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
