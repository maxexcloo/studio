import type { ReactNode } from "react";
import { Alert, Button, FocusTrap, Group, Modal, Stack, Text } from "@mantine/core";

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
      centered
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
        <Group justify="flex-end">
          <Button variant="default" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button color="red" loading={pending} disabled={disabled} onClick={onConfirm}>
            {action}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
