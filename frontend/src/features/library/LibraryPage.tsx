import { useState, type ReactNode } from "react";
import { Alert } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { WorkspaceSections, useWorkspaceSection } from "../../ui/WorkspaceSections";
import { useGenerationActions } from "../generation/GenerationProvider";
import { CatalogueEditor } from "./CatalogueEditor";
import {
  freeUpdate,
  LibraryCatalogueTable,
  libraryItemCategory,
  type LibraryItem,
} from "./LibraryCatalogueTable";
import { useStageComparison } from "../compare/variants";
import { LibraryUnused } from "./LibraryUnused";
import { LibraryCharacters } from "../characters/LibraryCharacters";
import { LibraryPromptCards } from "../characters/LibraryPromptCards";
import { LibraryDownloads } from "./LibraryDownloads";
import { LibraryImports } from "./LibraryImports";
import { GuideDefinitions, ProfileDefinitions } from "./ProfileDefinitions";
import { PromptStyles } from "./PromptStyles";
import { librarySections, useLibraryNavigation } from "./LibraryNavigation";
import { catalogueQuery, downloadsQuery, importsQuery } from "./queries";

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
    ...catalogueQuery,
    enabled: admin,
    refetchInterval: (query) =>
      catalogueActive &&
      query.state.data?.items.some((item) => item.applied?.state === "downloading")
        ? 2000
        : false,
  });
  const compare = useStageComparison();
  // Test LoRA compares the LoRA's strengths on the sample prompt of an import that brought it,
  // else its title; its trigger words are added when it runs.
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
    mutationFn: (choice: { key: string; alternative?: boolean } | { all: true } | undefined) =>
      post<UpdateResult>(`/api/library/updates/${choice ? "apply" : "check"}`, choice),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: catalogueQuery.queryKey });
      void client.invalidateQueries({ queryKey: downloadsQuery.queryKey });
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
          ? `${update.data.available} ${update.data.available === 1 ? "update" : "updates"} available.`
          : undefined);
  const items = catalogue.data?.items || [];
  const families = [
    ...new Set([
      ...profiles.flatMap((profile) => (profile.family ? [profile.family] : [])),
      ...items.flatMap((item) => item.families || []),
    ]),
  ].sort();
  const catalogueSection = (section: "models" | "loras") => (heading: ReactNode) =>
    catalogue.error ? (
      <>
        {heading}
        <Alert color="red">{catalogue.error.message}</Alert>
      </>
    ) : (
      <LibraryCatalogueTable
        heading={heading}
        loading={catalogue.isPending}
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
          guides: (heading) => <GuideDefinitions heading={heading} />,
          loras: catalogueSection("loras"),
          models: catalogueSection("models"),
          profiles: (heading) => <ProfileDefinitions heading={heading} />,
          promptStyles: (heading) => <PromptStyles heading={heading} />,
          unused: (heading) => <LibraryUnused heading={heading} />,
          downloads: (heading) => (
            <LibraryDownloads heading={heading} active={activeSection === "downloads"} />
          ),
        }}
      />
      {editing && (
        <CatalogueEditor item={editing} families={families} close={() => setEditing(null)} />
      )}
    </>
  );
}
