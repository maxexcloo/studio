import {
  Alert,
  Button,
  Checkbox,
  Input,
  MultiSelect,
  SegmentedControl,
  Select,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { loraName } from "../../../../shared/profiles";
import {
  type Project,
  type ProjectContent,
  maxProjectBrief,
  maxProjectLoras,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
} from "../../../../shared/projects";
import { resolutions } from "../../../../shared/resolution";
import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { TextBox } from "../../ui/TextBox";
import { CardForm } from "../characters/CardImages";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { profileOptions } from "../generation/ProfilePicker";
import { projectPath, projectsQuery } from "./queries";

export const blankProject: ProjectContent = {
  name: "",
  brief: { subjects: "", styles: "", avoid: "" },
  constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
};
/** The brief's text fields: key, label and what it holds. */
export const briefFields = [
  ["subjects", "Subjects", "Who or what the work shows."],
  ["ethnicity", "Ethnicity", "The person's ethnicity."],
  ["age", "Age", "The person's age range."],
  ["body", "Body", "The person's build and proportions."],
  ["styles", "Styles", "How it looks: medium, light, mood."],
  ["rules", "Banned Changes & Rules", "Standing rules every prompt keeps to."],
  ["avoid", "Avoid", "What prompts must never name, separated by commas."],
] as const;
export type BriefText = (typeof briefFields)[number][0];
export const aspectLabel = (aspect: string) => (aspect.includes(":") ? aspect : titleCase(aspect));

/** Saves a project's content, or a part of it: a new one without `id`. */
export function useSaveProject(id?: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (content: Partial<ProjectContent>) =>
      api<{ project: Project }>(id ? projectPath({ id }) : "/api/dream/projects", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(content),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
}

/**
 * A project's name, brief and constraints, from `initial`; its primary action (`action`, such as
 * Save or Accept) hands the edited content to `onSubmit`.
 */
export function ProjectForm({
  initial,
  action,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  initial: ProjectContent;
  action: string;
  pending: boolean;
  error?: string;
  onSubmit: (content: ProjectContent) => void;
  onClose: () => void;
}) {
  const models = useQuery(modelsQuery);
  const loras = useQuery(loraInfoQuery);
  const [draft, setDraft] = useState<ProjectContent>(() => structuredClone(initial));
  const brief = (key: BriefText, value: string) =>
    setDraft({ ...draft, brief: { ...draft.brief, [key]: value } });
  const constraint = (patch: Partial<ProjectContent["constraints"]>) =>
    setDraft({ ...draft, constraints: { ...draft.constraints, ...patch } });
  return (
    <CardForm onSubmit={() => onSubmit({ ...draft, name: draft.name.trim() })}>
      <TextInput
        label="Name"
        required
        maxLength={maxProjectName}
        data-autofocus
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
      />
      {briefFields.map(([key, label, description]) => (
        <TextBox
          key={key}
          label={label}
          description={description}
          autosize
          minRows={2}
          maxLength={maxProjectBrief}
          value={draft.brief[key] || ""}
          onChange={(value) => brief(key, value)}
        />
      ))}
      <MultiSelect
        label="Favourite LoRAs"
        searchable
        maxValues={maxProjectLoras}
        data={[
          ...new Set([...Object.keys(loras.data?.loras || {}), ...(draft.brief.loras || [])]),
        ].map((name) => ({
          value: name,
          label: loraName(name, loras.data?.loras?.[name]),
        }))}
        value={draft.brief.loras || []}
        onChange={(loras) => setDraft({ ...draft, brief: { ...draft.brief, loras } })}
      />
      <MultiSelect
        label="Profiles"
        description="Chats use only these; none for any."
        placeholder={draft.constraints.profiles.length ? undefined : "Any"}
        searchable
        nothingFoundMessage="No Matches"
        maxValues={maxProjectProfiles}
        data={profileOptions(models.data?.profiles || [])}
        value={draft.constraints.profiles}
        onChange={(profiles) => constraint({ profiles })}
      />
      <Select
        label="Aspect"
        allowDeselect={false}
        data={[
          { value: "", label: "Any" },
          ...projectAspects.map((aspect) => ({ value: aspect, label: aspectLabel(aspect) })),
        ]}
        value={draft.constraints.aspect}
        onChange={(aspect) => constraint({ aspect: aspect ?? "" })}
      />
      <Input.Wrapper label="Resolution">
        <SegmentedControl
          aria-label="Resolution"
          data={[{ value: "", label: "Any" }, ...resolutions]}
          value={draft.constraints.resolution}
          onChange={(resolution) =>
            constraint({ resolution: resolution as ProjectContent["constraints"]["resolution"] })
          }
        />
      </Input.Wrapper>
      <Checkbox
        label="Use LoRAs"
        checked={draft.constraints.loras}
        onChange={(event) => constraint({ loras: event.currentTarget.checked })}
      />
      {error && <Alert color="red">{error}</Alert>}
      <DialogFooter pending={pending} onCancel={onClose}>
        <Button type="submit" loading={pending} disabled={!draft.name.trim()}>
          {action}
        </Button>
      </DialogFooter>
    </CardForm>
  );
}
