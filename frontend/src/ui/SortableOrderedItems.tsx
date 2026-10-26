import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Feedback } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { Stack } from "@mantine/core";
import type { ComponentProps } from "react";
import { useMotionDuration } from "./Appearance";
import { OrderedItemRow, type OrderedItemsProps } from "./OrderedItems";

function SortableItem({
  id,
  duration,
  ...props
}: ComponentProps<typeof OrderedItemRow> & { id: string; duration: number }) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index: props.index,
    type: props.kind,
    accept: props.kind,
    transition: { duration },
  });
  return (
    <OrderedItemRow {...props} elementRef={ref} handleRef={handleRef} isDragging={isDragging} />
  );
}

export default function SortableOrderedItems<T>({
  items,
  identity,
  label,
  onChange,
  children,
  kind,
}: OrderedItemsProps<T>) {
  const duration = useMotionDuration();
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    onChange(arrayMove(items, from, to));
  }
  return (
    <DragDropProvider
      plugins={(defaults) =>
        defaults.map((plugin) =>
          plugin === Feedback
            ? Feedback.configure({
                dropAnimation: duration ? { duration } : null,
                keyboardTransition: duration ? { duration } : null,
              })
            : plugin,
        )
      }
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source } = event.operation;
        // Optimistic sorting updates the source's index before React receives the drop.
        if (isSortable(source)) move(source.initialIndex, source.index);
      }}
    >
      <Stack gap="xs" role="list">
        {items.map((item, index) => (
          <SortableItem
            key={identity(item)}
            id={identity(item)}
            index={index}
            label={label(item)}
            kind={kind}
            count={items.length}
            move={move}
            duration={duration}
          >
            {children(item, index)}
          </SortableItem>
        ))}
      </Stack>
    </DragDropProvider>
  );
}
