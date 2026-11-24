import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { cardKinds, maxCardName } from "../../../../shared/characters";
import {
  type Accepted,
  type Inbox,
  type Proposal,
  type ProposalChange,
  type SavedCard,
  maxDismissReason,
} from "../../../../shared/inbox";
import type { Project } from "../../../../shared/projects";
import { maxTasteRule } from "../../../../shared/taste";
import { post } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextBox } from "../../ui/TextBox";
import { useHold } from "../../ui/useHold";
import { usePhone, useTouch } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { CardDescription, CardDialog, CardForm, CardThumbnails } from "../characters/CardImages";
import { useMediaPreview } from "../gallery/MediaPreview";
import { tasteQuery } from "../taste/TasteProfile";
import { type BriefText, ProjectForm, briefFields } from "./ProjectForm";
import { type DreamItem, inboxQuery, proposalPath } from "./queries";
import { wordDiff } from "./wordDiff";

type Shown = Proposal<DreamItem>;
const cardIcons = { characters: icons.character, outfits: icons.outfit, scenes: icons.scene };
const kindIcon = (proposal: Shown) =>
  proposal.change.card
    ? cardIcons[proposal.change.card.kind]
    : {
        project: icons.project,
        brief: icons.edit,
        rule: icons.rule,
        pacing: icons.pacing,
        card: icons.character,
      }[proposal.kind];
const briefLabel = (key: string) => briefFields.find(([field]) => field === key)?.[1] ?? key;
/** Whether Edit then Accept has anything to edit: pausing or giving turns has not. */
const editable = ({ change }: Shown) =>
  Boolean(change.project || change.brief || change.rule !== undefined || change.card);

/** Everything a settled proposal changes: the Inbox, projects, the deck, rules and cards. */
function useSettled() {
  const client = useQueryClient();
  return (inbox: Inbox<DreamItem>, proposal?: Shown) => {
    client.setQueryData(inboxQuery.queryKey, inbox);
    void client.invalidateQueries({ queryKey: ["dream"] });
    if (proposal?.kind === "rule") void client.invalidateQueries({ queryKey: tasteQuery.queryKey });
    if (proposal?.change.card)
      void client.invalidateQueries({ queryKey: [proposal.change.card.kind] });
  };
}

/** A timed banner saying what happened to a proposal, with Undo, which takes it back. */
function useUndoBanner() {
  const settled = useSettled();
  const undo = useMutation({
    mutationFn: (proposal: Shown) => post<Inbox<DreamItem>>(proposalPath(proposal, "undo"), {}),
    onSuccess: (inbox, proposal) => settled(inbox, proposal),
  });
  return (message: string, proposal: Shown) => {
    const notification = notifications.show({
      autoClose: 10000,
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{message}</Text>
          <Button
            size="compact-sm"
            variant="subtle"
            style={{ flexShrink: 0 }}
            onClick={() => {
              notifications.hide(notification);
              undo.mutate(proposal);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
    });
  };
}

/** Accepts a proposal, as proposed or with the person's edits, then offers Undo. */
function useAccept() {
  const settled = useSettled();
  const banner = useUndoBanner();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: ({ proposal, change }: { proposal: Shown; change?: ProposalChange }) =>
      post<Accepted<DreamItem>>(proposalPath(proposal, "accept"), change ? { change } : {}),
    onSuccess: ({ accepted, ...inbox }, { proposal }) => {
      settled(inbox, proposal);
      banner(`Accepted ${accepted.title}`, proposal);
    },
  });
}

/** Declining one proposal, or Clearing the Inbox, with an optional reason that teaches Dream. */
function DismissDialog({
  title,
  opened,
  pending,
  error,
  onDismiss,
  onClose,
}: {
  title: string;
  opened: boolean;
  pending: boolean;
  error?: string;
  onDismiss: (reason: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const phone = usePhone();
  const [reason, setReason] = useState("");
  return (
    <Modal
      id={id}
      opened={opened}
      onClose={closeWhenTop(id, () => !pending && onClose())}
      onExitTransitionEnd={() => setReason("")}
      title={title}
      fullScreen={phone}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onDismiss(reason.trim());
        }}
      >
        <Stack>
          <TextBox
            label="Reason"
            description="Optional: what Dream should learn from it."
            value={reason}
            onChange={setReason}
            autosize
            minRows={2}
            maxLength={maxDismissReason}
          />
          {error && <Alert color="red">{error}</Alert>}
          <DialogFooter pending={pending} onCancel={onClose}>
            <Button type="submit" loading={pending}>
              {title === "Clear Inbox" ? "Clear" : "Decline"}
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}

/** Edit then Accept: the proposal's change as the person wants it. */
function ProposalEditor({
  proposal,
  pending,
  error,
  onAccept,
  onClose,
}: {
  proposal: Shown;
  pending: boolean;
  error?: string;
  onAccept: (change: ProposalChange) => void;
  onClose: () => void;
}) {
  const [change, setChange] = useState<ProposalChange>(() => structuredClone(proposal.change));
  if (change.project)
    return (
      <ProjectForm
        initial={change.project}
        action="Accept"
        pending={pending}
        error={error}
        onSubmit={(project) => onAccept({ ...change, project })}
        onClose={onClose}
      />
    );
  const { brief, rule, card } = change;
  return (
    <CardForm onSubmit={() => onAccept(change)}>
      {brief &&
        (Object.keys(brief) as BriefText[]).map((key) => (
          <TextBox
            key={key}
            label={briefLabel(key)}
            autosize
            minRows={2}
            value={String(brief[key] ?? "")}
            onChange={(value) => setChange({ ...change, brief: { ...brief, [key]: value } })}
          />
        ))}
      {rule !== undefined && (
        <TextBox
          label="Rule"
          description="A rule that only bans (never X, no X) joins your Exclusions; any other joins My Preferences in Settings › Taste."
          autosize
          minRows={2}
          maxLength={maxTasteRule}
          value={rule}
          onChange={(value) => setChange({ ...change, rule: value })}
        />
      )}
      {card && (
        <>
          <TextInput
            label="Name"
            required
            maxLength={maxCardName}
            value={card.name}
            onChange={(event) =>
              setChange({ ...change, card: { ...card, name: event.currentTarget.value } })
            }
          />
          <CardDescription
            kind={card.kind}
            name={card.name}
            images={[]}
            value={card.description}
            onChange={(description) => setChange({ ...change, card: { ...card, description } })}
          />
        </>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <DialogFooter pending={pending} onCancel={onClose}>
        <Button
          type="submit"
          loading={pending}
          disabled={(rule !== undefined && !rule.trim()) || (card && !card.name.trim())}
        >
          Accept
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** A text field's new words against its old, removed words struck. */
export function BriefDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <Text size="sm">
      <Text span c="dimmed" size="sm">
        {label}:{" "}
      </Text>
      {wordDiff(before, after).map((part, index) =>
        part.change === "removed" ? (
          <Text key={index} span size="sm" c="red" td="line-through">
            {part.text}
          </Text>
        ) : part.change === "added" ? (
          <Text key={index} span size="sm" c="green">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

/** A new project's sample results, larger than evidence and marked Draft. */
function Drafts({ items, label }: { items: DreamItem[]; label: string }) {
  const preview = useMediaPreview();
  return (
    <Group gap={6} role="group" aria-label={label}>
      {items.map((item, index) => (
        <Stack key={item.id} gap={2} align="center">
          <UnstyledButton
            aria-label={`Preview Draft ${index + 1}`}
            onClick={() => preview.open(items, index)}
          >
            <Image
              src={item.thumbnailUrl || item.url}
              alt=""
              h={96}
              w={96}
              radius="md"
              loading="lazy"
            />
          </UnstyledButton>
          <Badge size="xs" color="gray">
            Draft
          </Badge>
        </Stack>
      ))}
      {preview.element}
    </Group>
  );
}

function ProposalCard({
  proposal,
  project,
  accepting,
  declining,
  onAccept,
  onEdit,
  onDecline,
  onReason,
}: {
  proposal: Shown;
  project?: Project;
  accepting: boolean;
  declining: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDecline: () => void;
  onReason: () => void;
}) {
  const Icon = kindIcon(proposal);
  // Touch screens have no tooltips, so they say once, until the first Decline, that holding asks why.
  const touch = useTouch();
  const [declineHinted, setDeclineHinted] = useRemembered("project-decline-hint", false);
  const { consumeClick, ...hold } = useHold(proposal.id, () => {
    setDeclineHinted(true);
    onReason();
  });
  const { change } = proposal;
  const pictures = (items: DreamItem[]) =>
    items.map((item, index) => ({
      key: item.id,
      src: item.url,
      thumbnailUrl: item.thumbnailUrl,
      alt: `${proposal.title} ${index + 1}`,
    }));
  return (
    <Paper withBorder p="md" radius="md" component="article" aria-label={proposal.title}>
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Icon
            size={18}
            aria-hidden
            style={{ flexShrink: 0, marginTop: 2, color: "var(--mantine-color-dimmed)" }}
          />
          <Stack gap={2} flex={1} miw={0}>
            <Text size="sm" fw={600}>
              {proposal.title}
            </Text>
            <Text size="sm" c="dimmed">
              {proposal.why}
            </Text>
          </Stack>
        </Group>
        {change.brief &&
          Object.entries(change.brief).map(([key, value]) => (
            <BriefDiff
              key={key}
              label={briefLabel(key)}
              before={String(project?.brief[key as BriefText] ?? "")}
              after={String(value ?? "")}
            />
          ))}
        {change.rule && <Text size="sm">{change.rule}</Text>}
        {change.card && (
          <Text size="sm">
            <Text span size="sm" fw={500}>
              {change.card.name}:{" "}
            </Text>
            {change.card.description}
          </Text>
        )}
        {change.project &&
          (["subjects", "styles"] as const).map(
            (key) =>
              change.project?.brief[key] && (
                <Text key={key} size="sm">
                  <Text span c="dimmed" size="sm">
                    {briefLabel(key)}:{" "}
                  </Text>
                  {change.project.brief[key]}
                </Text>
              ),
          )}
        {proposal.drafts && proposal.drafts.length > 0 && (
          <Drafts items={proposal.drafts} label={`${proposal.title} Drafts`} />
        )}
        {proposal.evidence.length > 0 && (
          <CardThumbnails
            label={`${proposal.title} Evidence`}
            images={pictures(proposal.evidence)}
          />
        )}
        <Group gap="xs" justify="flex-end">
          {editable(proposal) && (
            <Button
              size="compact-sm"
              variant="subtle"
              disabled={accepting || declining}
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
          <Tooltip label="Hold to Add a Reason">
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              aria-description="Hold to Add a Reason"
              aria-keyshortcuts="Shift+F10"
              disabled={accepting}
              loading={declining}
              {...hold}
              onClick={(event) => {
                if (consumeClick(event)) return;
                setDeclineHinted(true);
                onDecline();
              }}
            >
              Decline
            </Button>
          </Tooltip>
          <Button
            size="compact-sm"
            variant="default"
            disabled={declining}
            loading={accepting}
            onClick={onAccept}
          >
            Accept
          </Button>
        </Group>
        {touch && !declineHinted && (
          <Text size="xs" c="dimmed" ta="right">
            Hold Decline to add a reason
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * Proposals as cards, each accepted as proposed, edited then accepted, or declined: at once, or
 * with a reason that teaches Dream after a hold. Accepting and declining both offer Undo. `projects` give brief edits their current text
 * to compare with.
 */
export function ProposalList({ proposals, projects }: { proposals: Shown[]; projects: Project[] }) {
  const accept = useAccept();
  const settled = useSettled();
  const banner = useUndoBanner();
  const [editing, setEditing] = useState<Shown | null>(null);
  const [reasoning, setReasoning] = useState<Shown | null>(null);
  const decline = useMutation({
    meta: { inlineError: true },
    mutationFn: ({ proposal, reason }: { proposal: Shown; reason: string }) =>
      post<Inbox<DreamItem>>(proposalPath(proposal, "dismiss"), reason ? { reason } : {}),
    onSuccess: (inbox, { proposal }) => {
      settled(inbox, proposal);
      setReasoning(null);
      banner(`Declined ${proposal.title}`, proposal);
    },
  });
  return (
    <>
      <Stack gap="sm">
        {proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            project={projects.find((project) => project.id === proposal.projectId)}
            accepting={accept.isPending && accept.variables?.proposal.id === proposal.id}
            declining={
              !reasoning && decline.isPending && decline.variables?.proposal.id === proposal.id
            }
            onAccept={() => accept.mutate({ proposal })}
            onEdit={() => {
              accept.reset();
              setEditing(proposal);
            }}
            onDecline={() => decline.mutate({ proposal, reason: "" })}
            onReason={() => {
              decline.reset();
              setReasoning(proposal);
            }}
          />
        ))}
      </Stack>
      {!editing && accept.error && <Alert color="red">{accept.error.message}</Alert>}
      {!reasoning && decline.error && <Alert color="red">{decline.error.message}</Alert>}
      <CardDialog
        opened={editing !== null}
        title={editing?.title ?? ""}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ProposalEditor
            key={editing.id}
            proposal={editing}
            pending={accept.isPending}
            error={accept.error?.message}
            onAccept={(change) =>
              accept.mutate({ proposal: editing, change }, { onSuccess: () => setEditing(null) })
            }
            onClose={() => setEditing(null)}
          />
        )}
      </CardDialog>
      <DismissDialog
        title="Decline"
        opened={reasoning !== null}
        pending={decline.isPending}
        error={decline.error?.message}
        onDismiss={(reason) => reasoning && decline.mutate({ proposal: reasoning, reason })}
        onClose={() => setReasoning(null)}
      />
    </>
  );
}

/** Dream › Projects' Inbox: what Dream proposes, below the projects; nothing shows when empty. */
export function ProjectInbox({ projects }: { projects: Project[] }) {
  const inbox = useQuery(inboxQuery);
  const client = useQueryClient();
  const settled = useSettled();
  const [clearing, setClearing] = useState(false);
  const clear = useMutation({
    meta: { inlineError: true },
    mutationFn: (reason: string) =>
      post<Inbox<DreamItem>>("/api/dream/inbox/clear", reason ? { reason } : {}),
    onSuccess: (next) => {
      settled(next);
      setClearing(false);
    },
  });
  const undoSave = useMutation({
    meta: { inlineError: true },
    mutationFn: (card: SavedCard) => post<Inbox<DreamItem>>(proposalPath(card, "undo"), {}),
    onSuccess: (next, card) => {
      settled(next);
      void client.invalidateQueries({ queryKey: [card.kind] });
    },
  });
  const proposals = inbox.data?.proposals || [];
  const saved = inbox.data?.savedCards || [];
  if (inbox.isError) return <Alert color="red">{inbox.error.message}</Alert>;
  return (
    <>
      {!!saved.length && (
        <SettingGroup title="Saved Cards">
          {saved.map((card) => (
            <SettingRow key={card.id} label={card.title} description={cardKinds[card.kind].name}>
              <Button
                variant="subtle"
                size="compact-sm"
                disabled={undoSave.isPending}
                aria-label={`Undo saving ${card.title}`}
                onClick={() => undoSave.mutate(card)}
              >
                Undo
              </Button>
            </SettingRow>
          ))}
          {undoSave.error && <Alert color="red">{undoSave.error.message}</Alert>}
        </SettingGroup>
      )}
      {!!proposals.length && (
        <SettingGroup
          title={`Inbox (${proposals.length})`}
          toolbar={
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              aria-label="Clear Inbox"
              onClick={() => {
                clear.reset();
                setClearing(true);
              }}
            >
              Clear
            </Button>
          }
        >
          <ProposalList proposals={proposals} projects={projects} />
          <DismissDialog
            title="Clear Inbox"
            opened={clearing}
            pending={clear.isPending}
            error={clear.error?.message}
            onDismiss={(reason) => clear.mutate(reason)}
            onClose={() => setClearing(false)}
          />
        </SettingGroup>
      )}
    </>
  );
}
