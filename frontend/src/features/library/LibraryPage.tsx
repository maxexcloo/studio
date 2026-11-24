import { Alert } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { WorkspaceSections, useWorkspaceSection } from "../../ui/WorkspaceSections";
import { LibraryCharacters } from "../characters/LibraryCharacters";
import { LibraryPromptCards } from "../characters/LibraryPromptCards";
import { charactersQuery, promptCardsQuery } from "../characters/queries";
import { loraTestProfile, useStageComparison } from "../compare/variants";
import { modelsQuery, useGenerationActions } from "../generation/GenerationProvider";
import { loraLibraryQuery } from "../generation/loraLibrary";
import { loraInfoQuery } from "../generation/LoraPicker";
import { presetsQuery } from "../generation/PresetPicker";
import { CatalogueEditor } from "./CatalogueEditor";
import {
  LibraryCatalogueTable,
  type LibraryItem,
  freeUpdate,
  libraryItemCategory,
} from "./LibraryCatalogueTable";
import { LibraryImports } from "./LibraryImports";
import {
  type InstructionSection,
  instructionAreas,
  librarySections,
  useLibraryNavigation,
} from "./LibraryNavigation";
import { LibraryPresets } from "./LibraryPresets";
import { GuideDefinitions, ProfileDefinitions, guidesQuery } from "./ProfileDefinitions";
import { PromptInstructions } from "./PromptInstructions";
import { PromptTemplates } from "./PromptStyles";
import {
  catalogueQuery,
  downloadsQuery,
  editableProfilesQuery,
  importsQuery,
  promptInstructionsQuery,
  promptStylesQuery,
} from "./queries";

/** Update All reports the updates that failed to start. */
type UpdateResult = { failed?: { key: string; error: string }[] };

/** One entry per instruction type's page, as the Library's sections maps take them. */
const instructionPages = <T,>(make: (section: InstructionSection) => T) =>
  Object.fromEntries(
    (Object.keys(instructionAreas) as InstructionSection[]).map((section) => [
      section,
      make(section),
    ]),
  ) as Record<InstructionSection, T>;

export function LibraryPage() {
  const { admin, options } = useLibraryNavigation();
  const { profiles } = useGenerationActions();
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);
  const client = useQueryClient();
  const { active: activeSection } = useWorkspaceSection(options);
  const catalogueActive = ["files", "loras"].includes(activeSection);
  const catalogue = useQuery({
    ...catalogueQuery,
    enabled: admin && catalogueActive,
    refetchInterval: (query) =>
      catalogueActive &&
      query.state.data?.items.some(
        (item) =>
          item.applied?.state === "downloading" ||
          ["queued", "downloading"].includes(item.install?.state || ""),
      )
        ? 2000
        : false,
  });
  const remove = useMutation({
    meta: { inlineError: true },
    mutationFn: (item: LibraryItem) =>
      post<{ note?: string }>("/api/library/catalogue/remove", { key: item.key }),
    onSuccess: ({ note }) => {
      for (const query of [catalogueQuery, loraInfoQuery, loraLibraryQuery, modelsQuery])
        void client.invalidateQueries({ queryKey: query.queryKey });
      setDeleting(null);
      if (note) notifications.show({ color: "yellow", message: note });
    },
  });
  const install = useMutation({
    mutationFn: (item: LibraryItem) => post("/api/library/catalogue/install", { key: item.key }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: catalogueQuery.queryKey });
      void client.invalidateQueries({ queryKey: downloadsQuery.queryKey });
    },
  });
  const compare = useStageComparison();
  const models = useQuery(modelsQuery);
  const loraInfo = useQuery(loraInfoQuery);
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
    onSuccess: ({ failed }) => {
      void client.invalidateQueries({ queryKey: catalogueQuery.queryKey });
      void client.invalidateQueries({ queryKey: downloadsQuery.queryKey });
      if (failed?.length)
        notifications.show({
          color: "red",
          message: failed.map((failure) => `${failure.key}: ${failure.error}`).join(" "),
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
  const catalogueSection = (section: "files" | "loras") => (heading: ReactNode) =>
    catalogue.error ? (
      <>
        {heading}
        <Alert color="red">{catalogue.error.message}</Alert>
      </>
    ) : (
      <LibraryCatalogueTable
        heading={heading}
        loading={catalogue.isPending}
        label={librarySections[section].label as "Files" | "LoRAs"}
        items={items.filter((item) =>
          section === "loras"
            ? libraryItemCategory(item) === "loras"
            : libraryItemCategory(item) !== "loras",
        )}
        onUpdate={
          admin ? (item, alternative) => update.mutate({ key: item.key, alternative }) : undefined
        }
        onInstall={admin && section === "loras" ? (item) => install.mutate(item) : undefined}
        installingKey={install.isPending ? install.variables?.key : undefined}
        onCheckUpdates={admin ? () => update.mutate(undefined) : undefined}
        onTest={section === "loras" ? (item) => testLora.mutate(item) : undefined}
        canTest={(item) =>
          Boolean(loraTestProfile(models.data, loraInfo.data?.loras, item.file || ""))
        }
        onUpdateAll={
          admin && items.some(freeUpdate) ? () => update.mutate({ all: true }) : undefined
        }
        inventoryError={catalogue.data?.inventoryError}
        onEdit={admin ? setEditing : undefined}
        onDelete={
          admin && section === "loras"
            ? (item) => {
                remove.reset();
                setDeleting(item);
              }
            : undefined
        }
        updatePending={update.isPending}
      />
    );
  return (
    <>
      <WorkspaceSections
        label="Library"
        sections={options}
        queries={{
          characters: [charactersQuery],
          guides: [guidesQuery],
          imports: [importsQuery],
          outfits: [promptCardsQuery("outfits")],
          presets: [presetsQuery],
          profiles: [editableProfilesQuery],
          animateTemplates: [promptStylesQuery],
          changeTemplates: [promptStylesQuery],
          improveTemplates: [promptStylesQuery],
          ...instructionPages(() => [promptInstructionsQuery]),
          scenes: [promptCardsQuery("scenes")],
        }}
        content={{
          characters: (heading) => <LibraryCharacters heading={heading} />,
          outfits: (heading) => <LibraryPromptCards kind="outfits" heading={heading} />,
          scenes: (heading) => <LibraryPromptCards kind="scenes" heading={heading} />,
          imports: (heading) => (
            <LibraryImports heading={heading} active={activeSection === "imports"} admin={admin} />
          ),
          guides: (heading) => <GuideDefinitions heading={heading} />,
          loras: catalogueSection("loras"),
          presets: (heading) => <LibraryPresets heading={heading} />,
          profiles: (heading) => <ProfileDefinitions heading={heading} />,
          ...instructionPages((section) => (heading: ReactNode) => (
            <PromptInstructions section={section} heading={heading} />
          )),
          animateTemplates: (heading) => (
            <PromptTemplates kind="animate" label="Animate Templates" heading={heading} />
          ),
          changeTemplates: (heading) => (
            <PromptTemplates kind="change" label="Edit & Recreate Templates" heading={heading} />
          ),
          improveTemplates: (heading) => (
            <PromptTemplates kind="improve" label="Improve Prompt Templates" heading={heading} />
          ),
          files: catalogueSection("files"),
        }}
      />
      {editing && (
        <CatalogueEditor item={editing} families={families} close={() => setEditing(null)} />
      )}
      <ConfirmDialog
        opened={Boolean(deleting)}
        title="Delete LoRA"
        action="Delete"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      >
        Delete {deleting?.title || deleting?.file || deleting?.key} from the catalogue and remove
        its installed file?
      </ConfirmDialog>
    </>
  );
}
