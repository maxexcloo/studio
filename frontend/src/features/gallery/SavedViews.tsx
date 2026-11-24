import { Button, Modal, Stack, TextInput } from "@mantine/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { type GallerySort, gallerySortLabels } from "../../../../shared/gallery-sort";
import type { MediaKind } from "../../types";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { closeWhenTop } from "../../ui/popupClicks";
import { preferencesQuery, useSavePreferences } from "../settings/accountPreferences";
import { type GalleryFilterValues, emptyGalleryFilters, useActiveFilters } from "./GalleryFilters";
import { galleryListingCountQuery } from "./queries";

/** A gallery view the account saved: a name with the search, filters and sort it restores. */
export interface SavedGalleryView {
  id: string;
  name: string;
  search: string;
  filters: GalleryFilterValues;
  sort: GallerySort;
}
/** What the gallery shows now, as a saved view holds it. */
type Shown = Omit<SavedGalleryView, "id" | "name">;

/** Filters in one shape, so a view saved before a filter existed still matches. */
const filtersOf = (filters: Partial<GalleryFilterValues>): GalleryFilterValues =>
  Object.fromEntries(
    Object.entries(emptyGalleryFilters).map(([key, value]) => [
      key,
      filters[key as keyof GalleryFilterValues] ?? value,
    ]),
  ) as unknown as GalleryFilterValues;
const matches = (view: SavedGalleryView, shown: Shown) =>
  view.search === shown.search &&
  view.sort === shown.sort &&
  JSON.stringify(filtersOf(view.filters)) === JSON.stringify(filtersOf(shown.filters));

/**
 * The gallery's saved views, kept with the account's preferences so they follow it: the view menu's
 * choices with their counts once `counted`, the one showing now, and its Save, Rename and Delete
 * actions with their dialogs.
 */
export function useSavedViews(kind: MediaKind, shown: Shown, counted: boolean) {
  const views = useQuery(preferencesQuery).data?.preferences.galleryViews ?? [];
  const save = useSavePreferences(views);
  const counts = useQueries({
    queries: views.map((view) => ({
      ...galleryListingCountQuery({
        search: view.search,
        kind,
        filters: filtersOf(view.filters),
        sort: view.sort,
      }),
      enabled: counted,
    })),
  });
  const current = views.find((view) => matches(view, shown));
  const [naming, setNaming] = useState<"save" | "rename" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const chips = useActiveFilters({ kind, value: shown.filters, onChange: () => {} });
  // "Kromafine · Liked · Past Week": the search, then what the toolbar shows as on.
  const suggested = [
    shown.search,
    shown.filters.uploads && "Uploads",
    shown.filters.rating === "liked" && "Liked",
    ...chips.map((chip) => chip.label),
    shown.sort !== "newest" && gallerySortLabels[shown.sort],
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    current: current?.id,
    choices: views.map((view, index) => ({
      value: `saved:${view.id}` as const,
      label: view.name,
      count: counts[index]?.data,
    })),
    view: (value: string) => views.find((view) => `saved:${view.id}` === value),
    actions: current
      ? [
          { label: "Rename View…", onClick: () => setNaming("rename") },
          { label: "Delete View", onClick: () => setDeleting(true) },
        ]
      : [
          {
            label: "Save View…",
            disabled: !suggested,
            onClick: () => setNaming("save"),
          },
        ],
    dialogs: (
      <>
        <NameDialog
          key={naming || ""}
          opened={naming !== null}
          title={naming === "rename" ? "Rename View" : "Save View"}
          initial={naming === "rename" ? current?.name || "" : suggested}
          taken={(name) =>
            views.some(
              (view) =>
                view.id !== (naming === "rename" ? current?.id : "") &&
                view.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
            )
          }
          onSave={(name) => {
            save.mutate({
              galleryViews:
                naming === "rename"
                  ? views.map((view) => (view.id === current?.id ? { ...view, name } : view))
                  : [...views, { id: crypto.randomUUID(), name, ...shown }],
            });
            setNaming(null);
          }}
          onClose={() => setNaming(null)}
        />
        <ConfirmDialog
          opened={deleting}
          title="Delete View"
          action="Delete"
          pending={false}
          onConfirm={() => {
            save.mutate({ galleryViews: views.filter((view) => view.id !== current?.id) });
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        >
          {`Delete ${current?.name}? The results it shows stay in the gallery.`}
        </ConfirmDialog>
      </>
    ),
  };
}

function NameDialog({
  opened,
  title,
  initial,
  taken,
  onSave,
  onClose,
}: {
  opened: boolean;
  title: string;
  initial: string;
  taken: (name: string) => boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const duplicate = Boolean(trimmed) && taken(trimmed);
  const submit = () => {
    if (trimmed && !duplicate) onSave(trimmed);
  };
  return (
    <Modal id={id} opened={opened} onClose={closeWhenTop(id, onClose)} title={title}>
      <Stack gap="md">
        <TextInput
          aria-label="Name"
          data-autofocus
          maxLength={80}
          value={name}
          error={duplicate && "A view has this name"}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
          }}
        />
        <DialogFooter onCancel={onClose}>
          <Button disabled={!trimmed || duplicate} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
