import {
  ActionIcon,
  Alert,
  Button,
  ScrollArea,
  Stack,
  Tooltip,
  getDefaultZIndex,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";

import type { Project } from "../../../../shared/projects";
import { api } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup } from "../../ui/SettingRows";
import { CardDialog } from "../characters/CardImages";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProjectCard } from "./ProjectCard";
import { ProjectForm, blankProject, useSaveProject } from "./ProjectForm";
import { ProjectInbox } from "./ProjectInbox";
import { ProjectSheet } from "./ProjectSheet";
import { inboxQuery, projectPath, projectsQuery } from "./queries";

/** New Project or Edit for one project, saved by the person. */
function ProjectEditor({ project, onClose }: { project?: Project; onClose: () => void }) {
  const save = useSaveProject(project?.id);
  return (
    <ProjectForm
      initial={project ?? blankProject}
      action="Save"
      pending={save.isPending}
      error={save.error?.message}
      onSubmit={({ name, brief, constraints }) =>
        save.mutate({ name, brief, constraints }, { onSuccess: onClose })
      }
      onClose={onClose}
    />
  );
}

/**
 * Dream's projects: the Inbox of what Dream proposes, then each project's card; a project opens in
 * its detail view at /dream/projects/:projectId. New Project stands in Dream's toolbar
 * (`actionTarget`).
 */
export function DreamProjects({ actionTarget }: { actionTarget: HTMLDivElement | null }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projects = useQuery(projectsQuery);
  const inbox = useQuery(inboxQuery);
  const models = useQuery(modelsQuery);
  const [editing, setEditing] = useState<{ project?: Project }>();
  const [deleting, setDeleting] = useState<Project | null>(null);
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (project: Project) => api(projectPath(project), { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      return client.invalidateQueries({ queryKey: ["dream"] });
    },
  });
  const profileLabel = (id: string) =>
    models.data?.profiles.find((profile) => profile.id === id)?.label || id;
  const list = projects.data?.projects || [];
  const empty = !list.length && inbox.isSuccess && !inbox.data.proposals.length;
  return (
    <>
      {actionTarget &&
        createPortal(
          <Tooltip label="New Project">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="New Project"
              onClick={() => setEditing({})}
            >
              <icons.add size={18} />
            </ActionIcon>
          </Tooltip>,
          actionTarget,
        )}
      {projects.isPending ? (
        <LoadingState fill label="Loading Projects" />
      ) : projects.isError ? (
        <Alert color="red" title="Couldn't Load Projects">
          {projects.error.message}
        </Alert>
      ) : !list.length && inbox.isPending ? (
        <LoadingState fill label="Loading Inbox" />
      ) : empty ? (
        <EmptyState
          fill
          action={
            <Button leftSection={<icons.add size={16} />} onClick={() => setEditing({})}>
              New Project
            </Button>
          }
        >
          No Projects
        </EmptyState>
      ) : (
        <ScrollArea flex={1} mih={0}>
          <Stack w="100%" maw={760} mx="auto" gap="lg" pb="md">
            <ProjectInbox projects={list} />
            {list.length > 0 && (
              <SettingGroup title="Projects">
                <Stack gap="sm">
                  {list.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      stats={projects.data.stats?.[project.id]}
                      profileLabel={profileLabel}
                      onEdit={() => setEditing({ project })}
                      onDelete={() => {
                        deletion.reset();
                        setDeleting(project);
                      }}
                    />
                  ))}
                </Stack>
              </SettingGroup>
            )}
          </Stack>
        </ScrollArea>
      )}
      <ProjectSheet
        projectId={projectId}
        projects={list}
        profileLabel={profileLabel}
        onEdit={(project) => setEditing({ project })}
        onClose={() => navigate("/dream/projects")}
      />
      <CardDialog
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing?.project ? "Edit Project" : "New Project"}
      >
        {editing && (
          <ProjectEditor
            key={editing.project?.id || "new"}
            project={editing.project}
            onClose={() => setEditing(undefined)}
          />
        )}
      </CardDialog>
      <ConfirmDialog
        opened={deleting !== null}
        title="Delete Project"
        action="Delete"
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
