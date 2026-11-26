import {
  Alert,
  Button,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { type CardKind, cardKinds } from "../../../../shared/characters";
import { loraName } from "../../../../shared/profiles";
import {
  type Project,
  type ProjectBriefTextField,
  type ProjectContent,
  type ProjectRange,
  anyConstraints,
  briefLabels,
  maxProjectLoras,
  maxProjectName,
  maxProjectProfiles,
  projectAspects,
  projectBriefTextFields,
  projectRangeInputs,
  rangeLabels,
} from "../../../../shared/projects";
import { type Resolution, resolutions } from "../../../../shared/resolution";
import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import { ClearButton } from "../../ui/ClearButton";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { TextToolsBar } from "../../ui/TextBox";
import type { SheetTyping } from "../../ui/TextEntrySheet";
import { useGroupFeature } from "../auth/AccountGate";
import { CardForm } from "../characters/CardImages";
import { charactersQuery, promptCardsQuery } from "../characters/queries";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { profileOptions } from "../generation/ProfilePicker";
import { ProjectBriefField } from "./ProjectBriefField";
import { projectPath, projectsQuery } from "./queries";

import classes from "./ProjectForm.module.css";

// "Any" as a switch's value, as an unset switch allows either.
const any = "any";

export const blankProject: ProjectContent = {
  name: "",
  brief: { description: "", styles: "", avoid: "" },
  constraints: anyConstraints(),
};
const briefHints: Record<ProjectBriefTextField, string> = {
  description: "What the work shows, the people's looks and any standing rules.",
  styles: "How it looks: medium, light, mood.",
  avoid: "What prompts must never name, separated by commas.",
};
/** The brief's text fields: key, label and what it holds. */
export const briefFields = projectBriefTextFields.map(
  (key) => [key, briefLabels[key], briefHints[key]] as const,
);
export type BriefText = ProjectBriefTextField;
export const aspectLabel = (aspect: string) => (aspect.includes(":") ? aspect : titleCase(aspect));
/** "Any" for an unset switch, as a segmented choice's value. */
const switchValue = (value?: boolean) => (value === undefined ? any : value ? "on" : "off");

/** A number input's bounds as a pair of fields, either left open as Any. */
function RangeRow({
  label,
  range = {},
  onChange,
}: {
  label: string;
  range?: ProjectRange;
  onChange: (range: ProjectRange) => void;
}) {
  const bound = (key: keyof ProjectRange) => (
    <NumberInput
      aria-label={`${label} ${key === "min" ? "Minimum" : "Maximum"}`}
      placeholder={key === "min" ? "Min" : "Max"}
      w={88}
      size="xs"
      min={0}
      decimalScale={2}
      value={range[key] ?? ""}
      onChange={(value) => {
        const next = { ...range };
        if (typeof value === "number") next[key] = value;
        else delete next[key];
        onChange(next);
      }}
    />
  );
  return (
    <SettingRow label={label}>
      {bound("min")}
      {bound("max")}
    </SettingRow>
  );
}

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
  const briefBox = ([key, label, description]: (typeof briefFields)[number]) => {
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
  };
  const fields = briefFields.map(briefBox);
  const { constraints } = draft;
  const loraChoices = [
    ...new Set([
      ...Object.keys(loras.data?.loras || {}),
      ...(draft.brief.loras || []),
      ...(constraints.loras === "none" ? [] : constraints.loras),
    ]),
  ].map((name) => ({ value: name, label: loraName(name, loras.data?.loras?.[name]) }));
  const pick = (
    label: string,
    value: string[],
    data: (
      | string
      | { value: string; label: string }
      | { group: string; items: { value: string; label: string }[] }
    )[],
    onChange: (value: string[]) => void,
    max?: number,
  ) => (
    <SettingRow label={label} wide>
      <MultiSelect
        aria-label={label}
        placeholder={value.length ? undefined : "Any"}
        searchable
        nothingFoundMessage="No Matches"
        maxValues={max}
        comboboxProps={{ withinPortal: false }}
        data={data}
        value={value}
        onChange={onChange}
        flex={1}
      />
    </SettingRow>
  );
  const toggle = (label: string, key: "sound" | "transparent") => (
    <SettingRow label={label} wide>
      <SegmentedControl
        aria-label={label}
        fullWidth
        data={[
          { value: any, label: "Any" },
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
        value={switchValue(constraints[key])}
        onChange={(value) => {
          const next = { ...constraints };
          if (value === any) delete next[key];
          else next[key] = value === "on";
          setDraft({ ...draft, constraints: next });
        }}
      />
    </SettingRow>
  );
  const allowed = (
    <SettingGroup title="Generation Limits">
      <Text size="sm" c="dimmed">
        Chats and Dream keep to these limits; Any leaves an option open.
      </Text>
      {pick(
        "Aspects",
        constraints.aspects,
        projectAspects.map((aspect) => ({ value: aspect, label: aspectLabel(aspect) })),
        (aspects) => constraint({ aspects }),
      )}
      {pick(
        "Favourite LoRAs",
        draft.brief.loras || [],
        loraChoices,
        (favourites) => setDraft({ ...draft, brief: { ...draft.brief, loras: favourites } }),
        maxProjectLoras,
      )}
      <SettingRow label="LoRAs" description="Off runs none.">
        <Switch
          aria-label="Use LoRAs"
          checked={constraints.loras !== "none"}
          onChange={(event) => constraint({ loras: event.currentTarget.checked ? [] : "none" })}
        />
      </SettingRow>
      {constraints.loras !== "none" &&
        pick(
          "Allowed LoRAs",
          constraints.loras,
          loraChoices,
          (names) => constraint({ loras: names }),
          maxProjectLoras,
        )}
      {pick(
        "Models",
        constraints.profiles,
        profileOptions(models.data?.profiles || []),
        (profiles) => constraint({ profiles }),
        maxProjectProfiles,
      )}
      {pick("Resolutions", constraints.resolutions, [...resolutions], (sizes) =>
        constraint({ resolutions: sizes as Resolution[] }),
      )}
      {toggle("Sound", "sound")}
      {toggle("Transparency", "transparent")}
      {projectRangeInputs.map((key) => (
        <RangeRow
          key={key}
          label={rangeLabels[key]}
          range={constraints.ranges[key]}
          onChange={(range) => {
            const ranges = { ...constraints.ranges, [key]: range };
            if (range.min === undefined && range.max === undefined) delete ranges[key];
            constraint({ ranges });
          }}
        />
      ))}
    </SettingGroup>
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
            {!field && allowed}
            {!field && alert}
          </Stack>
          <div className={classes.footer}>
            {/* Keyed apart, so the click that ends typing can't land on Create as it replaces Done. */}
            {field ? (
              <DialogFooter key="typing">
                <div className={classes.tools} ref={setToolsBar} />
                <Button onMouseDown={(event) => event.preventDefault()} onClick={typing.done}>
                  Done
                </Button>
              </DialogFooter>
            ) : (
              <Fragment key="form">{footer}</Fragment>
            )}
          </div>
        </>
      ) : (
        <>
          {name}
          {fields}
          {pins}
          {allowed}
          {alert}
          {footer}
        </>
      )}
    </CardForm>
  );
}
