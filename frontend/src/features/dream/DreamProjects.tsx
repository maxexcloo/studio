import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  getDefaultZIndex,
  Group,
  Menu,
  MultiSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { TextBox } from "../../ui/TextBox";
import { menuWidth } from "../../theme";
import { resolutions } from "../../../../shared/resolution";
import {
  maxProjectBrief,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
  type Project,
  type ProjectContent,
} from "../../../../shared/projects";
import { CardDialog, CardForm } from "../characters/CardImages";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileOptions } from "../generation/ProfilePicker";
import { projectPath, projectsQuery } from "./queries";

const blank: ProjectContent = {
  name: "",
  brief: { subjects: "", styles: "", avoid: "" },
  constraints: { profiles: [], loras: true, aspect: "", resolution: "" },
};
const briefFields = [
  ["subjects", "Subjects", "Who or what the work shows."],
  ["styles", "Styles", "How it looks: medium, light, mood."],
  ["avoid", "Avoid", "What prompts must never name, separated by commas."],
] as const;
const aspectLabel = (aspect: string) =>
  aspect.includes(":") ? aspect : aspect[0].toUpperCase() + aspect.slice(1);

/** Saves a project's content: a new one without `id`. */
function useSaveProject(id?: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (content: ProjectContent) =>
      api<{ project: Project }>(id ? projectPath({ id }) : "/api/dream/projects", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(content),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
}

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const models = useQuery(modelsQuery);
  const [draft, setDraft] = useState<ProjectContent>(() =>
    structuredClone(
      project
        ? { name: project.name, brief: project.brief, constraints: project.constraints }
        : blank,
    ),
  );
  const save = useSaveProject(project?.id);
  const brief = (key: keyof ProjectContent["brief"], value: string) =>
    setDraft({ ...draft, brief: { ...draft.brief, [key]: value } });
  const constraint = (patch: Partial<ProjectContent["constraints"]>) =>
    setDraft({ ...draft, constraints: { ...draft.constraints, ...patch } });
  return (
    <CardForm
      onSubmit={() => save.mutate({ ...draft, name: draft.name.trim() }, { onSuccess: onClose })}
    >
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
          value={draft.brief[key]}
          onChange={(value) => brief(key, value)}
        />
      ))}
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
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Resolution
        </Text>
        <SegmentedControl
          aria-label="Resolution"
          data={[{ value: "", label: "Any" }, ...resolutions]}
          value={draft.constraints.resolution}
          onChange={(resolution) =>
            constraint({ resolution: resolution as ProjectContent["constraints"]["resolution"] })
          }
        />
      </Stack>
      <Checkbox
        label="Use LoRAs"
        checked={draft.constraints.loras}
        onChange={(event) => constraint({ loras: event.currentTarget.checked })}
      />
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={onClose}>
        <Button type="submit" loading={save.isPending} disabled={!draft.name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

function ProjectCard({
  project,
  profileLabel,
  onEdit,
  onDelete,
}: {
  project: Project;
  profileLabel: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const client = useQueryClient();
  const undo = useMutation({
    mutationFn: () => api<{ project: Project }>(projectPath(project, "undo"), { method: "POST" }),
    onSettled: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
  const { brief, constraints, previous } = project;
  const badges = [
    ...constraints.profiles.map(profileLabel),
    ...(constraints.loras ? [] : ["No LoRAs"]),
    ...(constraints.aspect ? [aspectLabel(constraints.aspect)] : []),
    ...(constraints.resolution ? [constraints.resolution] : []),
  ];
  return (
    <Paper withBorder p="md" radius="md" component="section" aria-label={project.name}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={600} truncate>
            {project.name}
          </Text>
          <Menu position="bottom-end" width={menuWidth}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${project.name}`}>
                <icons.more size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<icons.edit size={16} />} onClick={onEdit}>
                Edit Project
              </Menu.Item>
              <Menu.Item color="red" leftSection={<icons.delete size={16} />} onClick={onDelete}>
                Delete Project
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        {briefFields.map(
          ([key, label]) =>
            brief[key] && (
              <Text key={key} size="sm">
                <Text span c="dimmed" size="sm">
                  {label}:{" "}
                </Text>
                {brief[key]}
              </Text>
            ),
        )}
        {badges.length > 0 && (
          <Group gap={6}>
            {badges.map((badge) => (
              <Badge key={badge} variant="light" color="gray">
                {badge}
              </Badge>
            ))}
          </Group>
        )}
        {previous && (
          <Group gap="xs" justify="space-between" role="status">
            <Text size="xs" c="dimmed">
              {previous.by === "chat" ? "Changed by a chat" : "Changed"}
            </Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<icons.undo size={14} />}
              loading={undo.isPending}
              onClick={() => undo.mutate()}
            >
              Undo
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

/** Dream's projects: each a brief and the constraints a chat attached to it keeps to. */
export function DreamProjects() {
  const client = useQueryClient();
  const projects = useQuery(projectsQuery);
  const models = useQuery(modelsQuery);
  const [editing, setEditing] = useState<{ project?: Project }>();
  const [deleting, setDeleting] = useState<Project | null>(null);
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (project: Project) => api(projectPath(project), { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      return client.invalidateQueries({ queryKey: projectsQuery.queryKey });
    },
  });
  const profileLabel = (id: string) =>
    models.data?.profiles.find((profile) => profile.id === id)?.label || id;
  const create = (
    <Button leftSection={<icons.add size={16} />} onClick={() => setEditing({})}>
      New Project
    </Button>
  );
  const list = projects.data?.projects || [];
  return (
    <>
      {projects.isPending ? (
        <LoadingState fill label="Loading Projects" />
      ) : projects.isError ? (
        <Alert color="red" title="Couldn’t Load Projects">
          {projects.error.message}
        </Alert>
      ) : !list.length ? (
        <EmptyState fill action={create}>
          No Projects Yet
        </EmptyState>
      ) : (
        <ScrollArea flex={1} mih={0}>
          <Stack w="100%" maw={760} mx="auto" gap="sm" pb="md">
            <Group justify="flex-end">{create}</Group>
            {list.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                profileLabel={profileLabel}
                onEdit={() => setEditing({ project })}
                onDelete={() => {
                  deletion.reset();
                  setDeleting(project);
                }}
              />
            ))}
          </Stack>
        </ScrollArea>
      )}
      <CardDialog
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing?.project ? "Edit Project" : "New Project"}
      >
        {editing && (
          <ProjectForm
            key={editing.project?.id || "new"}
            project={editing.project}
            onClose={() => setEditing(undefined)}
          />
        )}
      </CardDialog>
      <ConfirmDialog
        opened={deleting !== null}
        title="Delete Project"
        action="Delete Project"
        pending={deletion.isPending}
        error={deletion.error?.message}
        zIndex={getDefaultZIndex("overlay")}
        onConfirm={() => deleting && deletion.mutate(deleting)}
        onClose={() => setDeleting(null)}
      >
        {`Delete ${deleting?.name}? Chats using it keep going without it.`}
      </ConfirmDialog>
    </>
  );
}
