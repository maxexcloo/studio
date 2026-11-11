import { useRef, type ReactNode } from "react";
import { Alert, Button, FocusTrap, Group, Modal, Stack, Text } from "@mantine/core";

/** Every dialog's footer: Cancel, then its one primary action (`children`), at the right. */
export function DialogFooter({
  pending,
  onCancel,
  children,
}: {
  pending?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Group justify="flex-end">
      <Button variant="default" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
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
      closeButtonProps={{ disabled: pending }}
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
