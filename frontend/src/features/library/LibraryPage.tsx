import { useState } from "react";
import { Alert, SimpleGrid } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { WorkspaceSections } from "../../ui/WorkspaceSections";
import { useGenerationActions } from "../generation/GenerationProvider";
import { CatalogueEditor } from "./CatalogueEditor";
import { InspirationPreset, type LibraryPreset } from "./InspirationPreset";
import {
  LibraryCatalogueTable,
  libraryItemCategory,
  type LibraryItem,
} from "./LibraryCatalogueTable";
import { LibraryDownloads } from "./LibraryDownloads";
import { LibraryImports } from "./LibraryImports";
import { librarySections, useLibraryNavigation } from "./LibraryNavigation";

export function LibraryPage() {
  const { admin, imports: importsEnabled, options } = useLibraryNavigation();
  const { profiles } = useGenerationActions();
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const client = useQueryClient();
  const { hash } = useLocation();
  const activeSection =
    options.find((section) => `#${section.value}` === hash)?.value || options[0].value;
  const catalogueActive = ["models", "loras"].includes(activeSection);
  const catalogue = useQuery({
    queryKey: ["library"],
    queryFn: () =>
      api<{ items: LibraryItem[]; updates?: { checkedAt?: string; available: number } }>(
        "/api/library/items",
      ),
    refetchInterval: (query) =>
      catalogueActive &&
      query.state.data?.items.some((item) => item.applied?.state === "downloading")
        ? 2000
        : false,
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<{ presets: LibraryPreset[] }>("/api/presets"),
    enabled: importsEnabled,
  });
  const update = useMutation({
    mutationFn: (choice: { key: string; alternative?: boolean } | undefined) =>
      choice
        ? post<{ available: number }>("/api/library/updates/apply", choice)
        : post<{ available: number }>("/api/library/updates/check"),
    onSuccess: (result, choice) => {
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["library-downloads"] });
      notifications.show({
        message: choice
          ? "Update queued. The existing file stays until the replacement is verified and no longer in use."
          : result.available
            ? `${result.available} updates available.`
            : "Everything is up to date.",
      });
    },
  });
  const items = catalogue.data?.items || [];
  const families = [
    ...new Set([
      ...profiles.flatMap((profile) => (profile.family ? [profile.family] : [])),
      ...items.flatMap((item) => item.families || []),
    ]),
  ].sort();
  const catalogueSection = (section: "models" | "loras") =>
    catalogue.isPending ? (
      <LoadingState label={`Loading ${librarySections[section].label}`} />
    ) : catalogue.error ? (
      <Alert color="red">{catalogue.error.message}</Alert>
    ) : (
      <LibraryCatalogueTable
        label={librarySections[section].label as "Models" | "LoRAs"}
        items={items.filter((item) =>
          section === "loras"
            ? libraryItemCategory(item) === "loras"
            : libraryItemCategory(item) !== "loras",
        )}
        onUpdate={
          admin ? (item, alternative) => update.mutate({ key: item.key, alternative }) : undefined
        }
        onCheckUpdates={admin ? () => update.mutate(undefined) : undefined}
        checkingUpdates={update.isPending && !update.variables}
        onEdit={admin ? setEditing : undefined}
        updatePending={update.isPending}
      />
    );
  return (
    <>
      <WorkspaceSections
        label="Library"
        sections={options}
        content={{
          imports: (
            <LibraryImports active={importsEnabled && activeSection === "imports"} admin={admin} />
          ),
          presets: presets.isPending ? (
            <LoadingState label="Loading Inspiration" />
          ) : presets.error ? (
            <Alert color="red">{presets.error.message}</Alert>
          ) : !presets.data.presets.length ? (
            <EmptyState>No Inspiration</EmptyState>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {presets.data.presets.map((preset) => (
                <InspirationPreset key={preset.id} preset={preset} />
              ))}
            </SimpleGrid>
          ),
          models: catalogueSection("models"),
          loras: catalogueSection("loras"),
          downloads: <LibraryDownloads active={activeSection === "downloads"} />,
        }}
      />
      {editing && (
        <CatalogueEditor item={editing} families={families} close={() => setEditing(null)} />
      )}
    </>
  );
}
