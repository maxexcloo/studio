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
  LibraryCatalogueTable,
  libraryItemCategory,
  type LibraryItem,
} from "./LibraryCatalogueTable";
import { useCompare } from "../compare/CompareDialog";
import { LibraryCharacters } from "../characters/LibraryCharacters";
import { LibraryPromptCards } from "../characters/LibraryPromptCards";
import { LibraryDownloads } from "./LibraryDownloads";
import { importsQuery, LibraryImports } from "./LibraryImports";
import { GuideDefinitions, ProfileDefinitions } from "./ProfileDefinitions";
import { librarySections, useLibraryNavigation } from "./LibraryNavigation";

export function LibraryPage() {
  const { admin, imports: importsEnabled, options } = useLibraryNavigation();
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
    enabled: importsEnabled,
  });
  const compare = useCompare();
  // Test LoRA runs on the sample prompt of an import that brought the LoRA, else its title;
  // Compare adds its trigger words when it runs.
  const testLora = useMutation({
    mutationFn: async (item: LibraryItem) => {
      const file = item.file || "";
      const { imports } = await client.fetchQuery(importsQuery);
      const sample = imports.find(
        (record) =>
          record.preset?.prompt &&
          record.resources?.some(
            (resource) =>
              resource.role === "lora" && (resource.localName || resource.want?.file) === file,
          ),
      )?.preset?.prompt;
      await compare.testLora(file, sample || item.title || file);
    },
  });
  const update = useMutation({
    mutationFn: (choice: { key: string; alternative?: boolean } | undefined) =>
      choice
        ? post<{ available: number }>("/api/library/updates/apply", choice)
        : post<{ available: number }>("/api/library/updates/check"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["library-downloads"] });
    },
  });
  // The last check or update's outcome, shown under the catalogue toolbar; a check that finds
  // nothing shows nothing.
  const updateNote =
    update.data &&
    (update.variables
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
        onTest={section === "loras" ? (item) => testLora.mutate(item) : undefined}
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
            <LibraryImports
              heading={heading}
              active={importsEnabled && activeSection === "imports"}
              admin={admin}
            />
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
