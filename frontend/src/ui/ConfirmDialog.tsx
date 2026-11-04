import type { ReactNode } from "react";
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
