import { Alert, Stack, getDefaultZIndex } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import type { Project } from "../../../../shared/projects";
import { api } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { compareNames } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { type SheetTyping, TextEntrySheet } from "../../ui/TextEntrySheet";
import { usePhone } from "../../ui/usePhone";
import { CardDialog } from "../characters/CardImages";
import { MediaViewer } from "../gallery/MediaViewer";
import { modelsQuery } from "../generation/GenerationProvider";
import { type Verdict, viewerChoices } from "./choices";
import { useJudge } from "./DreamDeck";
import { ProjectCard } from "./ProjectCard";
import { ProjectForm, blankProject, useSaveProject } from "./ProjectForm";
import { ProjectInbox } from "./ProjectInbox";
import { ProjectSheet } from "./ProjectSheet";
import { type DreamItem, dreamQuery, inboxQuery, projectPath, projectsQuery } from "./queries";

/** New Project or Edit for one project, saved by the person. */
function ProjectEditor({
  project,
  onClose,
  typing,
}: {
  project?: Project;
  onClose: () => void;
  typing?: SheetTyping;
}) {
  const save = useSaveProject(project?.id);
  return (
    <ProjectForm
      initial={project ?? blankProject}
      action={project ? "Save" : "Create"}
      typing={typing}
      pending={save.isPending}
      error={save.error?.message}
      onSubmit={({ name, brief, constraints, cards }) =>
        save.mutate({ name, brief, constraints, cards }, { onSuccess: onClose })
      }
      onClose={project ? onClose : undefined}
    />
  );
}

/**
 * Project cards show what is new since the last visit. The viewer moves through results in
 * project order, and the Inbox follows the project list.
 */
export function DreamProjects({
  creating,
  onCloseCreate,
}: {
  creating: boolean;
  onCloseCreate: () => void;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams();
  const projects = useQuery(projectsQuery);
  const inbox = useQuery(inboxQuery);
  const models = useQuery(modelsQuery);
  const [editing, setEditing] = useState<Project>();
  const closeEditor = () => (editing ? setEditing(undefined) : onCloseCreate());
  const editorOpened = creating || editing !== undefined;
  const editorTitle = editing ? "Edit Project" : "New Project";
  const editor = (typing?: SheetTyping) =>
    editorOpened && (
      <ProjectEditor
        key={editing?.id || "new"}
        project={editing}
        onClose={closeEditor}
        typing={typing}
      />
    );
  const [deleting, setDeleting] = useState<Project | null>(null);
  const dream = useQuery(dreamQuery);
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const judge = useJudge(
    (card) =>
      card.kind === "dream" &&
      setDecided((previous) => {
        const next = new Set(previous);
        next.delete(card.item.id);
        return next;
      }),
  );
  const closeSheet = () =>
    location.state?.fromProjects ? navigate(-1) : navigate("/dream/projects", { replace: true });
  const startDeleting = (project: Project) => {
    deletion.reset();
    setDeleting(project);
  };
  const deletion = useMutation({
    meta: { inlineError: true },
    mutationFn: (project: Project) => api(projectPath(project), { method: "DELETE" }),
    onSuccess: (_answer, project) => {
      setDeleting(null);
      if (project.id === projectId) closeSheet();
      return client.invalidateQueries({ queryKey: ["dream"] });
    },
  });
  const profileLabel = (id: string) =>
    models.data?.profiles.find((profile) => profile.id === id)?.label || id;
  const list = [...(projects.data?.projects || [])].sort((a, b) => compareNames(a.name, b.name));
  // Each project's single results waiting for a verdict, newest first; comparisons stay in the deck.
  const unseen = (projectId: string) =>
    (dream.data?.unseen ?? [])
      .filter(
        (item) => item.dream?.projectId === projectId && !item.dream.pair && !decided.has(item.id),
      )
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const since = dream.data?.since ?? null;
  const fresh = (items: DreamItem[]) =>
    items.filter((item) => !since || String(item.createdAt || "") > since).length;
  // The viewer flips through every project's waiting results, in the cards' order.
  const order = list.flatMap((project) => unseen(project.id));
  const current = viewing ? order.find((item) => item.id === viewing) : undefined;
  if (viewing && !current) setViewing(null);
  function act(item: DreamItem, verdict: Verdict) {
    const index = order.findIndex((entry) => entry.id === item.id);
    const next = order[index + 1] || order[index - 1];
    setDecided((previous) => new Set(previous).add(item.id));
    if (viewing === item.id) setViewing(next?.id ?? null);
    judge.mutate({ card: { kind: "dream", key: item.id, item }, verdict });
  }
  return (
    <>
      {projects.isPending ? (
        <LoadingState fill label="Loading Projects" />
      ) : projects.isError ? (
        <Alert color="red" title="Couldn't Load Projects">
          {projects.error.message}
        </Alert>
      ) : !list.length && inbox.isPending ? (
        <LoadingState fill label="Loading Inbox" />
      ) : (
        <>
          {list.length > 0 ? (
            <Stack gap="sm">
              {list.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  stats={projects.data.stats?.[project.id]}
                  unseen={unseen(project.id)}
                  fresh={fresh(unseen(project.id))}
                  profileLabel={profileLabel}
                  onView={(item) => setViewing(item.id)}
                  onEdit={() => setEditing(project)}
                  onDelete={() => startDeleting(project)}
                />
              ))}
            </Stack>
          ) : (
            <EmptyState>Dream keeps making work to each project's brief.</EmptyState>
          )}
          <ProjectInbox projects={list} />
        </>
      )}
      {current && (
        <MediaViewer
          item={current}
          items={order}
          navigate={(item) => setViewing(item.id)}
          close={() => setViewing(null)}
          actions={viewerChoices({ kind: "dream", key: current.id, item: current }, (choice) =>
            act(current, choice as Verdict),
          )}
        />
      )}
      <ProjectSheet
        projectId={projectId}
        projects={projects.data && list}
        profileLabel={profileLabel}
        onEdit={setEditing}
        onClose={closeSheet}
      />
      {phone ? (
        <TextEntrySheet opened={editorOpened} onClose={closeEditor} title={editorTitle}>
          {editor}
        </TextEntrySheet>
      ) : (
        <CardDialog opened={editorOpened} onClose={closeEditor} title={editorTitle}>
          {editor()}
        </CardDialog>
      )}
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
