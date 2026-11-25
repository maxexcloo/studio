import { Button, Modal, Stack } from "@mantine/core";
import { useId, useState } from "react";

import type { Action } from "../../ui/ActionBar";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { closeWhenTop } from "../../ui/popupClicks";
import { TextBox } from "../../ui/TextBox";
import { TextEntrySheet } from "../../ui/TextEntrySheet";
import { useLastWhileClosing } from "../../ui/useLastWhileClosing";
import { usePhone } from "../../ui/usePhone";

import textClasses from "../../ui/TextBox.module.css";

/** Custom…'s request, sent with `action` or Enter. */
export function CustomDialog({
  opened,
  onClose,
  title: currentTitle,
  action: current,
  label,
  placeholder = "What should change, like “make it night”",
  onSend,
  draft,
  tools,
  zIndex,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  action: string;
  label?: string;
  placeholder?: string;
  onSend: (request: string) => void;
  draft?: { value: string; onChange: (value: string) => void };
  tools?: Action[];
  zIndex?: number;
}) {
  const phone = usePhone();
  const id = useId();
  const [text, setText] = useState("");
  const request = draft?.value ?? text;
  // Callers clear the record their action reads as they close.
  const action = useLastWhileClosing(opened ? current : null) ?? current;
  const title = useLastWhileClosing(opened ? currentTitle : null) ?? currentTitle;
  const trimmed = request.trim();
  const submit = () => {
    if (!trimmed) return;
    onClose();
    onSend(trimmed);
  };
  const content = (
    <form
      className={phone ? textClasses.body : undefined}
      data-text-box={phone ? "request" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        // A submit from the portal would also reach the composer's form.
        event.stopPropagation();
        submit();
      }}
    >
      <Stack flex={phone ? 1 : undefined} mih={phone ? 0 : undefined}>
        <TextBox
          aria-label={label || "Change"}
          placeholder={placeholder}
          autosize={!phone}
          minRows={3}
          inline
          submit={phone ? [{ label: action, disabled: !trimmed, onSubmit: submit }] : undefined}
          data-autofocus={!phone || undefined}
          value={request}
          onChange={draft?.onChange ?? setText}
          tools={tools}
          // Enter sends; Shift+Enter adds a line.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        {!phone && (
          <DialogFooter onCancel={onClose}>
            <Button type="submit" disabled={!trimmed}>
              {action}
            </Button>
          </DialogFooter>
        )}
      </Stack>
    </form>
  );
  return phone ? (
    <TextEntrySheet
      opened={opened}
      id={id}
      onClose={onClose}
      title={title}
      fieldTitles={{ request: title }}
      zIndex={zIndex}
    >
      {() => content}
    </TextEntrySheet>
  ) : (
    <Modal
      opened={opened}
      id={id}
      onClose={closeWhenTop(id, onClose)}
      title={title}
      size="sm"
      zIndex={zIndex}
    >
      {content}
    </Modal>
  );
}
