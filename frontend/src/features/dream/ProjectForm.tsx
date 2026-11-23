import {
  Alert,
  Button,
  Group,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { type CardKind, cardKinds } from "../../../../shared/characters";
import { loraName } from "../../../../shared/profiles";
import {
  type Project,
  type ProjectContent,
  maxProjectLoras,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
} from "../../../../shared/projects";
import { resolutions } from "../../../../shared/resolution";
import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import { ChipPopup } from "../../ui/ChipPopup";
import { ClearButton } from "../../ui/ClearButton";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextToolsBar } from "../../ui/TextBox";
import type { SheetTyping } from "../../ui/TextEntrySheet";
import { useGroupFeature } from "../auth/AccountGate";
import { CardForm } from "../characters/CardImages";
import { charactersQuery, promptCardsQuery } from "../characters/queries";
import { chipProps } from "../generation/chip";
import { ChipSelect } from "../generation/ChipSelect";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { profileName } from "../generation/payload";
import { profileOptions } from "../generation/ProfilePicker";
import { ProjectBriefField } from "./ProjectBriefField";
import { projectPath, projectsQuery } from "./queries";

import controls from "../generation/GenerationInputControls.module.css";
import classes from "./ProjectForm.module.css";

// "Any" as a choice's value, as the stored "" names no choice.
const any = "any";

/** A project field as one of the composer's chips, naming its choice and opening its popup. */
function FieldChip({
  title,
  icon: Icon,
  value,
  onClear,
  clearDisabled,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  value: string;
  onClear: () => void;
  clearDisabled: boolean;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <ChipPopup
      title={title}
      floating
      // The project dialog stacks above popovers.
      withinPortal={false}
      width={340}
      position="bottom-start"
      opened={opened}
      onOpenedChange={setOpened}
      onClear={onClear}
      clearDisabled={clearDisabled}
      target={
        <Button
          {...chipProps}
          aria-label={title}
          aria-expanded={opened}
          leftSection={Icon && <Icon size={16} />}
          rightSection={<ChevronDown size={14} />}
          onClick={() => setOpened(!opened)}
        >
          <span className={controls.label}>{value}</span>
        </Button>
      }
    >
      {children}
    </ChipPopup>
  );
}

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

export function ProjectPins({
  cards,
  onChange,
}: {
  cards?: ProjectContent["cards"];
  onChange?: (cards: NonNullable<ProjectContent["cards"]>) => void;
}) {
  const enabled = useGroupFeature("characters");
  const lists = {
    characters: useQuery({
      ...charactersQuery,
      enabled: enabled && Boolean(onChange || cards?.characters),
    }),
    outfits: useQuery({
      ...promptCardsQuery("outfits"),
      enabled: enabled && Boolean(onChange || cards?.outfits),
    }),
    scenes: useQuery({
      ...promptCardsQuery("scenes"),
      enabled: enabled && Boolean(onChange || cards?.scenes),
    }),
  };
  if (!enabled || (!onChange && !cards)) return null;
  return (
    <SettingGroup title="Pinned Cards">
      {onChange && (
        <Text size="sm" c="dimmed">
          Dream keeps pinned cards fixed and varies the open parts of the brief.
        </Text>
      )}
      {(Object.keys(cardKinds) as CardKind[]).map((kind) => {
        const label = titleCase(cardKinds[kind].name);
        const id = cards?.[kind];
        const list = lists[kind];
        const current = list.data?.find((card) => card.id === id);
        if (!onChange)
          return id ? (
            <SettingRow key={kind} label={label}>
              <Text size="sm">
                {current?.name || (list.isPending ? "Loading…" : "Unavailable")}
              </Text>
            </SettingRow>
          ) : null;
        const options = (list.data || []).map((card) => ({ value: card.id, label: card.name }));
        if (list.isSuccess && id && !current) options.push({ value: id, label: "Unavailable" });
        return (
          <SettingRow key={kind} label={label} wide>
            <Select
              aria-label={label}
              placeholder="Unpinned"
              value={id || null}
              data={options}
              disabled={list.isPending}
              error={list.error?.message}
              clearable
              searchable
              comboboxProps={{ withinPortal: false }}
              nothingFoundMessage="No Matches"
              onChange={(value) => {
                const next = { ...cards };
                if (value) next[kind] = value;
                else delete next[kind];
                onChange(next);
              }}
            />
          </SettingRow>
        );
      })}
    </SettingGroup>
  );
}

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
  typing,
  error,
  onSubmit,
  onClose,
}: {
  initial: ProjectContent;
  action: string;
  pending: boolean;
  typing?: SheetTyping;
  error?: string;
  onSubmit: (content: ProjectContent) => void;
  onClose?: () => void;
}) {
  const models = useQuery(modelsQuery);
  const loras = useQuery(loraInfoQuery);
  const [draft, setDraft] = useState<ProjectContent>(() => structuredClone(initial));
  const [toolsBar, setToolsBar] = useState<HTMLDivElement | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const field = typing?.field;
  useLayoutEffect(() => {
    if (!field && fieldsRef.current) fieldsRef.current.scrollTop = scrollTop.current;
  }, [field]);
  const brief = (key: BriefText, value: string) =>
    setDraft((previous) => ({ ...previous, brief: { ...previous.brief, [key]: value } }));
  const constraint = (patch: Partial<ProjectContent["constraints"]>) =>
    setDraft({ ...draft, constraints: { ...draft.constraints, ...patch } });
  const profileLabel = (id: string) => {
    const profile = models.data?.profiles.find((profile) => profile.id === id);
    return profile ? profileName(profile) : id;
  };
  const name = (
    <TextInput
      label="Name"
      required
      maxLength={maxProjectName}
      data-autofocus
      value={draft.name}
      onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
    />
  );
  const fields = briefFields.map(([key, label, description]) => {
    const box = (
      <ProjectBriefField
        key={key}
        field={key}
        draft={draft}
        label={label}
        description={field ? undefined : description}
        autosize={field !== key}
        inline={Boolean(typing)}
        onChange={(value) => brief(key, value)}
      />
    );
    return typing ? (
      <div key={key} data-text-box={key} hidden={Boolean(field && field !== key)}>
        {box}
      </div>
    ) : (
      box
    );
  });
  const chips = (
    <Group gap="xs">
      <FieldChip
        title="Profiles"
        value={
          draft.constraints.profiles.length
            ? draft.constraints.profiles.map(profileLabel).join(", ")
            : "Any Profile"
        }
        onClear={() => constraint({ profiles: [] })}
        clearDisabled={!draft.constraints.profiles.length}
      >
        <MultiSelect
          label="Profiles"
          description="Chats use only these; none for any."
          placeholder={draft.constraints.profiles.length ? undefined : "Any"}
          searchable
          nothingFoundMessage="No Matches"
          maxValues={maxProjectProfiles}
          comboboxProps={{ withinPortal: false }}
          data={profileOptions(models.data?.profiles || [])}
          value={draft.constraints.profiles}
          onChange={(profiles) => constraint({ profiles })}
        />
      </FieldChip>
      <FieldChip
        title="LoRAs"
        icon={icons.loras}
        value={
          !draft.constraints.loras
            ? "No LoRAs"
            : draft.brief.loras?.length
              ? draft.brief.loras
                  .map((name) => loraName(name, loras.data?.loras?.[name]))
                  .join(", ")
              : "LoRAs"
        }
        onClear={() => setDraft({ ...draft, brief: { ...draft.brief, loras: [] } })}
        clearDisabled={!draft.brief.loras?.length}
      >
        <Switch
          label="Use LoRAs"
          checked={draft.constraints.loras}
          onChange={(event) => constraint({ loras: event.currentTarget.checked })}
        />
        <MultiSelect
          label="Favourite LoRAs"
          searchable
          disabled={!draft.constraints.loras}
          maxValues={maxProjectLoras}
          comboboxProps={{ withinPortal: false }}
          data={[
            ...new Set([...Object.keys(loras.data?.loras || {}), ...(draft.brief.loras || [])]),
          ].map((name) => ({
            value: name,
            label: loraName(name, loras.data?.loras?.[name]),
          }))}
          value={draft.brief.loras || []}
          onChange={(loras) => setDraft({ ...draft, brief: { ...draft.brief, loras } })}
        />
      </FieldChip>
      <ChipSelect
        name="Aspect"
        withinPortal={false}
        label={draft.constraints.aspect ? aspectLabel(draft.constraints.aspect) : "Any Aspect"}
        data={[
          { value: any, label: "Any" },
          ...projectAspects.map((aspect) => ({ value: aspect, label: aspectLabel(aspect) })),
        ]}
        value={draft.constraints.aspect || any}
        onChange={(aspect) => constraint({ aspect: aspect === any ? "" : (aspect ?? "") })}
      />
      <ChipSelect
        name="Resolution"
        withinPortal={false}
        label={draft.constraints.resolution || "Any Resolution"}
        data={[{ value: any, label: "Any" }, ...resolutions]}
        value={draft.constraints.resolution || any}
        onChange={(resolution) =>
          constraint({
            resolution: (resolution === any
              ? ""
              : resolution) as ProjectContent["constraints"]["resolution"],
          })
        }
      />
    </Group>
  );
  const footer = (
    <DialogFooter pending={pending} onCancel={onClose}>
      <ClearButton
        disabled={pending}
        onClear={() => setDraft({ ...structuredClone(blankProject), name: draft.name, cards: {} })}
      />
      <Button type="submit" loading={pending} disabled={!draft.name.trim()}>
        {action}
      </Button>
    </DialogFooter>
  );
  const alert = error && <Alert color="red">{error}</Alert>;
  const pins = (
    <ProjectPins cards={draft.cards} onChange={(cards) => setDraft({ ...draft, cards })} />
  );
  return (
    <CardForm
      onSubmit={() => {
        if (field) typing?.done();
        else onSubmit({ ...draft, name: draft.name.trim() });
      }}
    >
      {typing ? (
        <>
          <Stack
            ref={fieldsRef}
            className={classes.fields}
            data-typing-field={field}
            onScroll={(event) => {
              if (!field) scrollTop.current = event.currentTarget.scrollTop;
            }}
          >
            <div data-text-box="name" hidden={Boolean(field && field !== "name")}>
              {name}
            </div>
            <TextToolsBar.Provider value={toolsBar}>{fields}</TextToolsBar.Provider>
            {!field && pins}
            {!field && alert}
          </Stack>
          <div className={classes.footer}>
            {field ? (
              <DialogFooter>
                <div className={classes.tools} ref={setToolsBar} />
                <Button onMouseDown={(event) => event.preventDefault()} onClick={typing.done}>
                  Done
                </Button>
              </DialogFooter>
            ) : (
              <>
                {chips}
                {footer}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {name}
          {fields}
          {pins}
          {chips}
          {alert}
          {footer}
        </>
      )}
    </CardForm>
  );
}
