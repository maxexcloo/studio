import { Button, Modal, Stack } from "@mantine/core";
import { type ReactNode, useId, useState } from "react";

import type { Action } from "../../ui/ActionBar";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { closeWhenTop } from "../../ui/popupClicks";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";

/**
 * Custom…'s box: what to change, typed in a small dialog of its own (full screen on phones) rather
 * than over the text it changes, sent with `action` or Enter. The last request stays for the next
 * time; `suggestions` (given what picking one does) fill it and send at once.
 */
export function CustomDialog({
  opened,
  onClose,
  title,
  action,
  label = "Change",
  placeholder = "What should change, like “make it night”",
  onSend,
  suggestions,
  zIndex,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  action: string;
  label?: string;
  placeholder?: string;
  onSend: (request: string) => void;
  suggestions?: (
    pick: (request: string) => void,
    render: (action: Action) => ReactNode,
  ) => ReactNode;
  zIndex?: number;
}) {
  const phone = usePhone();
  const id = useId();
  const [request, setRequest] = useState("");
  const send = (text: string) => {
    onClose();
    onSend(text);
  };
  const form = (tools: Action[] = []) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // React carries a submit through the portal to the composer's own form, which would Generate.
        event.stopPropagation();
        if (request.trim()) send(request.trim());
      }}
    >
      <Stack>
        <TextBox
          label={label}
          placeholder={placeholder}
          autosize
          minRows={3}
          // The dialog is already full screen on phones.
          inline
          tools={tools}
          data-autofocus
          value={request}
          onChange={setRequest}
          // Enter sends; Shift+Enter adds a line.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <DialogFooter onCancel={onClose}>
          <Button type="submit" disabled={!request.trim()}>
            {action}
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
  return (
    <Modal
      opened={opened}
      id={id}
      onClose={closeWhenTop(id, onClose)}
      title={title}
      size="sm"
      fullScreen={phone}
      zIndex={zIndex}
    >
      {suggestions
        ? suggestions(
            (picked) => {
              setRequest(picked);
              send(picked);
            },
            (action) => form([action]),
          )
        : form()}
    </Modal>
  );
}
