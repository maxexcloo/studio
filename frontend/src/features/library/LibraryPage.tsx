import { useState, type ReactNode } from "react";
import { Alert, SimpleGrid } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { WorkspaceSections, useWorkspaceSection } from "../../ui/WorkspaceSections";
import { useGenerationActions } from "../generation/GenerationProvider";
import { CatalogueEditor } from "./CatalogueEditor";
import { InspirationPreset, type LibraryPreset } from "./InspirationPreset";
import {
  freeUpdate,
  LibraryCatalogueTable,
  libraryItemCategory,
  type LibraryItem,
} from "./LibraryCatalogueTable";
import { LibraryCharacters } from "../characters/LibraryCharacters";
import { LibraryPromptCards } from "../characters/LibraryPromptCards";
import { LibraryDownloads } from "./LibraryDownloads";
import { LibraryImports } from "./LibraryImports";
import { GuideDefinitions, ProfileDefinitions } from "./ProfileDefinitions";
import { librarySections, useLibraryNavigation } from "./LibraryNavigation";

/** A check's or an update's answer; Update All also says how many started and which failed. */
type UpdateResult = {
  available: number;
  started?: number;
  failed?: { key: string; error: string }[];
};

export function LibraryPage() {
  const { admin, options } = useLibraryNavigation();
  const { profiles } = useGenerationActions();
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const client = useQueryClient();
  const { active: activeSection } = useWorkspaceSection(options);
  const catalogueActive = ["models", "loras"].includes(activeSection);
  const catalogue = useQuery({
    queryKey: ["library"],
    enabled: admin,
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
    enabled: admin,
  });
  const update = useMutation({
    mutationFn: (choice: { key: string; alternative?: boolean } | { all: true } | undefined) =>
      post<UpdateResult>(`/api/library/updates/${choice ? "apply" : "check"}`, choice),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["library-downloads"] });
    },
  });
  // The last check or update's outcome, shown under the catalogue toolbar; a check that finds
  // nothing shows nothing.
  const updateNote =
    update.data &&
    (update.variables && "all" in update.variables
      ? [
          `${update.data.started} ${update.data.started === 1 ? "update" : "updates"} queued.`,
          ...(update.data.failed || []).map((failure) => `${failure.key}: ${failure.error}`),
        ].join(" ")
      : update.variables
        ? "Update queued. The current file stays until the new one is verified and free."
        : update.data.available
          ? `${update.data.available} updates available.`
          : undefined);
  const items = catalogue.data?.items || [];
  const families = [
    ...new Set([
      ...profiles.flatMap((profile) => (profile.family ? [profile.family] : [])),
      ...items.flatMap((item) => item.families || []),
    ]),
  ].sort();
  const catalogueSection = (section: "models" | "loras") => (heading: ReactNode) =>
    catalogue.isPending || catalogue.error ? (
      <>
        {heading}
        {catalogue.error ? (
          <Alert color="red">{catalogue.error.message}</Alert>
        ) : (
          <LoadingState label={`Loading ${librarySections[section].label}`} fill />
        )}
      </>
    ) : (
      <LibraryCatalogueTable
        heading={heading}
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
        onUpdateAll={
          admin && items.some(freeUpdate) ? () => update.mutate({ all: true }) : undefined
        }
        checkingUpdates={update.isPending && !update.variables}
        updateNote={updateNote || undefined}
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
          characters: (heading) => <LibraryCharacters heading={heading} />,
          outfits: (heading) => <LibraryPromptCards kind="outfits" heading={heading} />,
          scenes: (heading) => <LibraryPromptCards kind="scenes" heading={heading} />,
          imports: (heading) => (
            <LibraryImports heading={heading} active={activeSection === "imports"} admin={admin} />
          ),
          presets: presets.isPending ? (
            <LoadingState label="Loading Inspiration" fill />
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
          guides: (heading) => <GuideDefinitions heading={heading} />,
          loras: catalogueSection("loras"),
          models: catalogueSection("models"),
          profiles: (heading) => <ProfileDefinitions heading={heading} />,
          downloads: <LibraryDownloads active={activeSection === "downloads"} />,
        }}
      />
      {editing && (
        <CatalogueEditor item={editing} families={families} close={() => setEditing(null)} />
      )}
    </>
  );
}
