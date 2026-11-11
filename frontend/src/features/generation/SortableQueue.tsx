import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode, Ref } from "react";
import { useMotionDuration } from "../../ui/Appearance";
import { feedbackAt } from "../../ui/SortableOrderedItems";
import type { QueueEntry } from "./Queue";

export type QueueRowDrag = {
  elementRef: Ref<HTMLDivElement>;
  handleRef: Ref<HTMLButtonElement>;
  isDragging: boolean;
};
type Row = (entry: QueueEntry, drag?: QueueRowDrag) => ReactNode;

function SortableRow({
  entry,
  index,
  duration,
  row,
}: {
  entry: QueueEntry;
  index: number;
  duration: number;
  row: Row;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: entry.id,
    index,
    type: "queue",
    accept: "queue",
    transition: { duration },
  });
  return row(entry, { elementRef: ref, handleRef, isDragging });
}

/**
 * The queue's rows (a job, or a set's group), its waiting ones dragged by their handles (pointer,
 * touch or keyboard) to a new place among the waiting ones.
 */
export default function SortableQueue({
  entries,
  movable,
  row,
  onMove,
}: {
  entries: QueueEntry[];
  movable: QueueEntry[];
  row: Row;
  onMove: (entry: QueueEntry, to: number) => void;
}) {
  const duration = useMotionDuration();
  return (
    <DragDropProvider
      plugins={feedbackAt(duration)}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source } = event.operation;
        // Optimistic sorting updates the source's index before React receives the drop.
        if (isSortable(source) && source.index !== source.initialIndex)
          onMove(movable[source.initialIndex], source.index);
      }}
    >
      {entries.map((entry) => {
        const index = movable.indexOf(entry);
        return index < 0 ? (
          row(entry)
        ) : (
          <SortableRow key={entry.id} entry={entry} index={index} duration={duration} row={row} />
        );
      })}
    </DragDropProvider>
  );
}
