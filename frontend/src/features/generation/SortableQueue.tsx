import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode, Ref } from "react";
import type { QueueJob } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { feedbackAt } from "../../ui/SortableOrderedItems";

export type QueueRowDrag = {
  elementRef: Ref<HTMLDivElement>;
  handleRef: Ref<HTMLButtonElement>;
  isDragging: boolean;
};
type Row = (job: QueueJob, drag?: QueueRowDrag) => ReactNode;

function SortableRow({
  job,
  index,
  duration,
  row,
}: {
  job: QueueJob;
  index: number;
  duration: number;
  row: Row;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: job.id,
    index,
    type: "queue",
    accept: "queue",
    transition: { duration },
  });
  return row(job, { elementRef: ref, handleRef, isDragging });
}

/**
 * The queue's rows, its waiting ones dragged by their handles (pointer, touch or keyboard) to a new
 * place among the waiting ones.
 */
export default function SortableQueue({
  jobs,
  movable,
  row,
  onMove,
}: {
  jobs: QueueJob[];
  movable: QueueJob[];
  row: Row;
  onMove: (job: QueueJob, to: number) => void;
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
      {jobs.map((job) => {
        const index = movable.indexOf(job);
        return index < 0 ? (
          row(job)
        ) : (
          <SortableRow key={job.id} job={job} index={index} duration={duration} row={row} />
        );
      })}
    </DragDropProvider>
  );
}
