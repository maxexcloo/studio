import { Drawer, type DrawerProps, FocusTrap, VisuallyHidden } from "@mantine/core";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useMotionDuration } from "./Appearance";
import { closeWhenTop, layerAbove, popupLayer } from "./popupClicks";
import { useKeyboard, useKeyboardDrop, useTypingIn } from "./useKeyboard";

import classes from "./TextEntrySheet.module.css";

export interface SheetTyping {
  field?: string;
  done: () => void;
}

type SheetProps = Pick<
  DrawerProps,
  | "opened"
  | "onClose"
  | "onPaste"
  | "onDragOver"
  | "onDrop"
  | "returnFocus"
  | "onEnterTransitionEnd"
  | "onExitTransitionEnd"
> & {
  id?: string;
  title: string;
  hidden?: boolean;
  fieldTitles?: Record<string, string>;
  children: (typing: SheetTyping) => ReactNode;
};

const sheetField = (panel: HTMLElement, target: unknown) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
  panel.contains(target)
    ? target.closest<HTMLElement>("[data-text-box]")?.dataset.textBox
    : undefined;

/** A full-height phone drawer whose inline text editor follows the keyboard. */
export function TextEntrySheet({
  id,
  title,
  hidden,
  fieldTitles,
  onClose,
  children,
  ...props
}: SheetProps) {
  const generatedId = useId();
  const sheetId = id ?? generatedId;
  const duration = useMotionDuration();
  const sheet = useRef<HTMLElement>(null);
  const sheetFocus = useRef<HTMLSpanElement>(null);
  const tapping = useRef(false);
  const [field, setField] = useState<string>();
  const focusedField = useTypingIn(props.opened, (input) => input);
  const keyboard = useKeyboard(
    props.opened &&
      (focusedField ? Boolean(sheet.current?.contains(focusedField)) : field !== undefined),
    sheet,
  );
  const done = () => {
    if (layerAbove(sheet.current)) return;
    sheetFocus.current?.focus({ preventScroll: true });
    setField(undefined);
  };

  useEffect(() => {
    if (!props.opened) setField(undefined);
  }, [props.opened]);
  useKeyboardDrop(field !== undefined, () => {
    const focused = document.activeElement;
    if (sheet.current?.contains(focused) && focused instanceof HTMLElement) focused.blur();
    setField(undefined);
  });

  const fieldTitle = field && fieldTitles?.[field];
  return (
    <Drawer
      {...props}
      id={sheetId}
      onClose={closeWhenTop(sheetId, onClose)}
      title={
        fieldTitle ? (
          <>
            <VisuallyHidden>{title}</VisuallyHidden>
            <span aria-hidden>{fieldTitle}</span>
          </>
        ) : (
          title
        )
      }
      closeButtonProps={{ "aria-label": `Close ${fieldTitle || title}` }}
      position="bottom"
      size="100%"
      transitionProps={{ duration }}
      classNames={{
        content: classes.sheet,
        header: fieldTitle ? undefined : classes.header,
        body: classes.body,
      }}
      styles={{
        content: {
          translate: keyboard.top ? `0 ${keyboard.top}px` : undefined,
          "--keyboard-inset": `${keyboard.inset}px`,
        } as CSSProperties,
      }}
    >
      <FocusTrap.InitialFocus ref={sheetFocus} />
      <div
        ref={(panel) => {
          sheet.current = panel?.closest<HTMLElement>(".mantine-Drawer-content") ?? null;
        }}
        className={classes.panel}
        data-typing={field}
        onPointerDown={(event) => {
          const target = event.target;
          const name = sheetField(event.currentTarget, target);
          tapping.current = name !== undefined;
          // A tap on text already focused by its tools raises the keyboard again.
          if (name && target === document.activeElement) setField(name);
        }}
        onFocus={(event) => {
          const name = sheetField(event.currentTarget, event.target);
          if (name && (tapping.current || field !== undefined)) setField(name);
          tapping.current = false;
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (
            !sheetField(event.currentTarget, next) &&
            !(next instanceof Element && next.closest(`${popupLayer}, [data-text-tools]`))
          )
            setField(undefined);
        }}
        aria-hidden={hidden || !props.opened || undefined}
        inert={!props.opened}
      >
        {children({ field, done })}
      </div>
    </Drawer>
  );
}
