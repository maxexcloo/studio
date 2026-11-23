import {
  Button,
  FocusTrap,
  Group,
  Modal,
  Popover,
  type PopoverProps,
  Stack,
  Text,
} from "@mantine/core";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

import { popupMiddlewares } from "../theme";
import { ClearButton } from "./ClearButton";
import { DialogFooter } from "./ConfirmDialog";
import { PopupTooltip } from "./PopupTooltip";
import { usePhone, useTouch } from "./usePhone";
import { useSwipeClose } from "./useSwipeClose";

import classes from "./ChipPopup.module.css";

/**
 * A chip's floating popup fits the screen and scrolls inside when it is taller (a phone held
 * sideways, or a chip high in a dialog). It shifts only along its trigger, never over it.
 */
const fittedPopup = {
  middlewares: { ...popupMiddlewares, shift: { padding: 12 }, size: { padding: 12 } },
  classNames: { dropdown: classes.fitted },
};

/** Nested pickers, menus, open comboboxes and keyboard drags inside a panel handle their own Escape. */
const nestedLayers =
  '.mantine-Popover-dropdown, [role="menu"], [role="dialog"], [aria-haspopup][aria-expanded="true"]';

/**
 * A chip panel's Escape: closes the panel only when no nested layer, such as a chip popup opened
 * inside it (the picker's Filters), took the key.
 */
function escapePanel(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const layer = (event.target as Element).closest(nestedLayers);
  if (layer && layer !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

/**
 * A popup's or column's heading: its title and any `detail`, then a saved record's `name` (its
 * `SavedName`) filling the row, then any compact subtle `actions` at the end.
 */
export function PopupHeading({
  title,
  detail,
  name,
  actions,
}: {
  title: string;
  detail?: ReactNode;
  name?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Group
      className={classes.heading}
      justify="space-between"
      gap="xs"
      mih={28}
      wrap={name ? "wrap" : "nowrap"}
    >
      <Group gap="xs" wrap="nowrap" miw={0} flex={name ? "none" : undefined}>
        <Text fw={600} truncate>
          {title}
        </Text>
        {detail}
      </Group>
      {name}
      {actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}

/**
 * A chip's popup. Its heading holds the title, any `detail`, any saved record's `name` and any
 * compact subtle `actions` in one row, on desktop as in the phone sheet's header beside Close. Its footer is the shared `DialogFooter`:
 * at most one `leading` action that adds content (Add) at the left edge, then `onClear` as the shared ✕, then the
 * `primary`. Choices apply as they are made, so the footer ends with Done where it has no
 * `primary`, and desktop shows one only where it has an action besides Done.
 * An `aside`, such as the LoRA stack, starts with its own `PopupHeading`: desktop shows it as a
 * column beside everything else, divided to the top, above the footer; phones leave it out.
 * Desktop anchors a Popover to the chip; phones open a full-screen sheet whose content scrolls
 * between the header and the footer, pinned above the safe area, unless the popup is `floating`: a
 * small form, such as Settings or Presets, stays a popover fitted to the screen, as the rail's other
 * dropdowns. Escape closes nested layers first.
 */
export function ChipPopup({
  title,
  detail,
  name,
  opened,
  onOpenedChange,
  target,
  tooltip = false,
  actions,
  wide = false,
  position = "top-start",
  trap = true,
  withinPortal = true,
  floating = false,
  spacious = !floating,
  leading,
  onClear,
  clearDisabled,
  primary,
  aside,
  children,
}: {
  title: string;
  detail?: ReactNode;
  /** The `SavedName` of the record the popup edits. */
  name?: ReactNode;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  target: ReactNode;
  /** Icon-only chips name themselves with a tooltip: the title, or the label given. */
  tooltip?: boolean | string;
  actions?: ReactNode;
  /** Room for a picker grid beside an aside, such as LoRAs and References. */
  wide?: boolean;
  position?: PopoverProps["position"];
  /** Off while a confirmation over the popup owns focus and clicks. */
  trap?: boolean;
  /** Off for a popup inside another, so pressing in it is not outside its parent. */
  withinPortal?: boolean;
  /** A popover on phones too, instead of a full-screen sheet. */
  floating?: boolean;
  /** Reserves a minimum body height when anchored, including if floating on a phone. */
  spacious?: boolean;
  leading?: ReactNode;
  onClear?: () => void;
  clearDisabled?: boolean;
  primary?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  const touch = useTouch();
  const close = () => onOpenedChange(false);
  const footer = (
    <DialogFooter leading={leading}>
      {onClear && <ClearButton disabled={clearDisabled} onClear={onClear} />}
      {primary || <Button onClick={close}>Done</Button>}
    </DialogFooter>
  );
  // Pulling the phone sheet down by its header, or its content from the top, closes it.
  const swipe = useSwipeClose("down", close);
  // The popup handles its own Escape, so the composer's Drawer behind it stays open. A dialog it
  // opens, such as a card editor, portals elsewhere and keeps its own Escape.
  const layer = {
    "data-composer-layer": true,
    "data-chip-popup": true,
    "aria-label": title,
    onFocusCapture: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.target))
        event.target.setAttribute("data-mantine-stop-propagation", "true");
    },
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => trap && escapePanel(event, close);
  if (phone && !floating)
    return (
      <>
        {target}
        <Modal.Root
          opened={opened}
          onClose={close}
          fullScreen
          trapFocus={trap}
          closeOnEscape={false}
          returnFocus
          classNames={{ content: classes.sheet, body: classes.sheetBody }}
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so the phone popup listens in the capture phase. */}
          <Modal.Content {...layer} {...swipe} onKeyDownCapture={onKeyDown}>
            {/* The sheet itself takes focus, so its search doesn't raise the keyboard. */}
            <FocusTrap.InitialFocus />
            <Modal.Header className={classes.sheetHeader}>
              {/* The detail stays outside the title, which names the sheet. */}
              <div className={classes.sheetTitle} data-named={name ? true : undefined}>
                <Modal.Title>{title}</Modal.Title>
                {detail}
              </div>
              {name}
              {actions}
              <Modal.CloseButton aria-label={`Close ${title}`} />
            </Modal.Header>
            <Modal.Body>{children}</Modal.Body>
            {footer}
          </Modal.Content>
        </Modal.Root>
      </>
    );
  return (
    <Popover
      opened={opened}
      onChange={onOpenedChange}
      width={wide ? "var(--studio-popup-wide-width)" : "var(--studio-popup-width)"}
      position={position}
      trapFocus={trap}
      closeOnClickOutside={trap}
      closeOnEscape={false}
      returnFocus
      shadow="md"
      withinPortal={withinPortal}
      {...fittedPopup}
    >
      <PopupTooltip label={typeof tooltip === "string" ? tooltip : title} disabled={!tooltip}>
        <Popover.Target>{target}</Popover.Target>
      </PopupTooltip>
      <Popover.Dropdown
        data-popup-outside={trap}
        {...layer}
        aria-labelledby=""
        maw="calc(100vw - 24px)"
        onKeyDown={onKeyDown}
      >
        {/* Touch screens focus the popup itself, so its first field doesn't raise the keyboard. */}
        {touch && <FocusTrap.InitialFocus />}
        <Stack gap="sm">
          <div className={aside ? classes.columns : undefined}>
            <Stack gap="sm">
              <PopupHeading title={title} detail={detail} name={name} actions={actions} />
              {spacious ? <div className={classes.popupBody}>{children}</div> : children}
            </Stack>
            {aside && <div className={classes.aside}>{aside}</div>}
          </div>
          {(leading || onClear || primary) && footer}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
