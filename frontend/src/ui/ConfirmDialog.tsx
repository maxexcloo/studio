import { Alert, Box, Button, FocusTrap, Group, Menu, Modal, Stack, Text } from "@mantine/core";
import { type ReactNode, useRef } from "react";

import { menuWidth } from "../theme";
import { icons } from "./icons";
import { PopupTooltip } from "./PopupTooltip";
import { usePhone } from "./usePhone";

/** A footer's secondary action: a default button before Cancel. */
interface FooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * Every dialog's and sheet's footer, on one line at the right: any `secondary` actions (default
 * buttons, such as Check), Cancel, then its one filled primary action (`children`). Without
 * `onCancel`, where there is nothing to cancel, the action (Done, Close) follows the secondary
 * ones. A `leading` action that adds content (Add, Upload) sits apart at the left edge. Phones fold
 * two or more secondary actions into one ⋯ menu, so the row never wraps.
 */
export function DialogFooter({
  pending,
  onCancel,
  leading,
  secondary = [],
  children,
}: {
  pending?: boolean;
  onCancel?: () => void;
  leading?: ReactNode;
  secondary?: FooterAction[];
  children: ReactNode;
}) {
  const phone = usePhone();
  // A phone's full-screen dialog pins it to the bottom, in sight while the body scrolls (theme).
  return (
    <Group justify="flex-end" gap="xs" wrap="nowrap" data-dialog-footer>
      {leading && <Box me="auto">{leading}</Box>}
      {phone && secondary.length > 1 ? (
        <Menu position="top-end" width={menuWidth}>
          <PopupTooltip label="More Actions">
            <Menu.Target>
              <Button
                variant="default"
                px="xs"
                aria-label="More Actions"
                loading={secondary.some((action) => action.loading)}
              >
                <icons.more size={18} />
              </Button>
            </Menu.Target>
          </PopupTooltip>
          <Menu.Dropdown>
            {secondary.map((action) => (
              <Menu.Item
                key={action.label}
                disabled={action.disabled || action.loading || pending}
                onClick={action.onClick}
              >
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : (
        secondary.map((action) => (
          <Button
            key={action.label}
            variant="default"
            disabled={action.disabled || pending}
            loading={action.loading}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))
      )}
      {onCancel && (
        <Button variant="default" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      )}
      {children}
    </Group>
  );
}

/** Destructive confirmation that stays open and locked while the action runs. */
export function ConfirmDialog({
  opened,
  title,
  children,
  action,
  pending,
  error,
  disabled,
  zIndex,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title: string;
  children: ReactNode;
  action: string;
  pending: boolean;
  error?: ReactNode;
  disabled?: boolean;
  zIndex?: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const close = () => {
    if (!pending) onClose();
  };
  // Read as it opens, before the dialog takes focus.
  const origin = useRef<{ element?: HTMLElement; dialog?: HTMLElement | null }>({});
  const wasOpen = useRef(false);
  if (opened && !wasOpen.current && document.activeElement instanceof HTMLElement) {
    const element = document.activeElement;
    origin.current = { element, dialog: element.closest<HTMLElement>('[role="dialog"]') };
  }
  wasOpen.current = opened;
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={title}
      size="md"
      zIndex={zIndex}
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      closeButtonProps={{ "aria-label": "Close", disabled: pending }}
      // Where the action took away what had focus as the dialog opened (Clear All empties its
      // list), Mantine can't return focus to it; it goes to the dialog it was in instead, which
      // would otherwise lose Escape. After Mantine's own attempt.
      onExitTransitionEnd={() => {
        const { element, dialog } = origin.current;
        if (element && !element.isConnected)
          setTimeout(() => dialog?.isConnected && dialog.focus({ preventScroll: true }));
      }}
    >
      <FocusTrap.InitialFocus />
      <Stack>
        <Text size="sm" component="div">
          {children}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <DialogFooter pending={pending} onCancel={close}>
          <Button color="red" loading={pending} disabled={disabled} onClick={onConfirm}>
            {action}
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
