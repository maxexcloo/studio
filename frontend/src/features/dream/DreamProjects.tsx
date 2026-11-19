import {
  ActionIcon,
  Alert,
  Button,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  getDefaultZIndex,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router";

import type { Project } from "../../../../shared/projects";
import { api } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { dateFormat } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup } from "../../ui/SettingRows";
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

const sinceFormat = dateFormat({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

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
      onSubmit={({ name, brief, constraints }) =>
        save.mutate({ name, brief, constraints }, { onSuccess: onClose })
      }
      onClose={onClose}
    />
  );
}

/**
 * Dream's projects: how many of their results are new since the last visit, the Inbox of what
 * Dream proposes, then each project's card with its results waiting for a verdict, which the
 * viewer judges, moving on to the next after each; a project opens in its detail view at
 * /dream/projects/:projectId. New Project stands in Dream's toolbar (`actionTarget`).
 */
export function DreamProjects({ actionTarget }: { actionTarget: HTMLDivElement | null }) {
  const client = useQueryClient();
  const phone = usePhone();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams();
  const projects = useQuery(projectsQuery);
  const inbox = useQuery(inboxQuery);
  const models = useQuery(modelsQuery);
  const [editing, setEditing] = useState<{ project?: Project }>();
  const closeEditor = () => setEditing(undefined);
  const editorTitle = editing?.project ? "Edit Project" : "New Project";
  const editor = (typing?: SheetTyping) =>
    editing && (
      <ProjectEditor
        key={editing.project?.id || "new"}
        project={editing.project}
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
  const newCount = fresh(order);
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
            {dream.isSuccess && list.length > 0 && (
              <Text size="sm" c="dimmed">
                {newCount
                  ? `${newCount} new${since ? ` since ${sinceFormat.format(new Date(since))}` : ""}`
                  : "Nothing new since your last visit"}
              </Text>
            )}
            <ProjectInbox projects={list} />
            {list.length > 0 && (
              <SettingGroup title="Projects">
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
        projects={list}
        profileLabel={profileLabel}
        onEdit={(project) => setEditing({ project })}
        onClose={() =>
          location.state?.fromProjects
            ? navigate(-1)
            : navigate("/dream/projects", { replace: true })
        }
      />
      {phone ? (
        <TextEntrySheet opened={editing !== undefined} onClose={closeEditor} title={editorTitle}>
          {editor}
        </TextEntrySheet>
      ) : (
        <CardDialog opened={editing !== undefined} onClose={closeEditor} title={editorTitle}>
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
