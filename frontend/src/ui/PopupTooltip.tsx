import { Tooltip, usePopoverContext, type TooltipProps } from "@mantine/core";

/**
 * The tooltip of a popover's or menu's trigger, wrapping its `Popover.Target` or `Menu.Target`,
 * hidden while the popup is open.
 */
export function PopupTooltip({ disabled, ...props }: TooltipProps) {
  const { opened } = usePopoverContext();
  return <Tooltip disabled={disabled || opened} {...props} />;
}
