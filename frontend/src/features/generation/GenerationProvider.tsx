import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useForm } from "@mantine/form";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { GenerationInput, MediaKind, Models, Profile, ReferenceAsset } from "../../types";
import { api } from "../../api";
import { useRememberedKey } from "../auth/useRemembered";
import { setFamilyLabels } from "../../ui/modelFamily";
import { isProfile, profileForBackend, referencePatch } from "./payload";

export const modelsQuery = queryOptions({
  queryKey: ["models"],
  queryFn: async () => {
    const models = await api<Models>("/api/models?cached=1");
    setFamilyLabels(models.familyLabels);
    return models;
  },
});
export const initialInput: GenerationInput = {
  kind: "image",
  profileId: "",
  prompt: "",
  negative: "",
  width: 1024,
  height: 1024,
  steps: 20,
  cfg: 5,
  seed: "",
  count: 1,
  denoise: 0.65,
  fps: 24,
  frames: 81,
  loras: [],
  referenceAssets: [],
};
export function inputForProfile(previous: GenerationInput, profile: Profile): GenerationInput {
  return {
    ...initialInput,
    ...profile.defaults,
    prompt: previous.prompt,
    negative: previous.negative,
    referenceAssets: previous.referenceAssets,
    referenceDetails: previous.referenceDetails,
    kind: profile.kind,
    profileId: profile.id,
    model: profile.model,
    workflow: profile.workflow,
    loras: previous.loras,
  };
}
/** The configured default for an output, else its first ready profile, else any. */
export function defaultProfile(models: Models | undefined, kind: MediaKind) {
  const profiles = models?.profiles ?? emptyProfiles;
  const selected = kind === "image" ? models?.defaults?.imageModel : models?.defaults?.videoModel;
  return (
    profiles.find((profile) => profile.id === selected && profile.kind === kind) ||
    profiles.find((profile) => profile.kind === kind && profile.ready !== false) ||
    profiles.find((profile) => profile.kind === kind)
  );
}
export interface Draft {
  input: GenerationInput;
  references: ReferenceAsset[];
  sessionId: string;
  operation: "image" | "refine" | "animate";
  parentJobId?: string;
  /** The result in `parentJobId` this draft makes a version of. */
  parentItemId?: string;
  presetId?: string;
  presetTitle?: string;
  /**
   * The account's default profile, while the draft still runs on it rather than on one the person
   * picked: the draft then follows the default as the account's preferences or workers change.
   */
  defaultedProfileId?: string;
  /**
   * A comparison being set up (features/compare/variants.ts): every variant's settings, the one at
   * `active` being edited as `input` and `references`, whose stored copy is stale meanwhile.
   */
  compare?: { variants: Variant[]; active: number };
}
/** One compared variant's settings. */
export interface Variant {
  input: GenerationInput;
  references: ReferenceAsset[];
}
/**
 * The draft moved to `profile` for a picked character (CharacterChoices): the profile's settings,
 * the prompt led by the character, and its references placed for that profile.
 */
export function draftForProfile(
  previous: Draft,
  profile: Profile,
  next: { references: ReferenceAsset[]; prompt: string },
): Draft {
  const input = { ...inputForProfile(previous.input, profile), prompt: next.prompt };
  return {
    ...previous,
    references: next.references,
    input: { ...input, ...referencePatch(input, [], next.references, profile) },
  };
}
const empty: Draft = {
  input: initialInput,
  references: [],
  sessionId: "",
  operation: "image",
  parentJobId: undefined,
  parentItemId: undefined,
  presetId: undefined,
  presetTitle: undefined,
  compare: undefined,
};
const emptyProfiles: Profile[] = [];
const initialDrafts: Record<MediaKind, Draft> = {
  image: empty,
  video: { ...empty, input: { ...initialInput, kind: "video" }, operation: "animate" },
};
/** The gallery composer's image and video drafts as last saved for this account, over the defaults. */
function savedDrafts(key: string): Record<MediaKind, Draft> {
  const saved: Partial<Record<MediaKind, Draft>> = key
    ? JSON.parse(localStorage.getItem(key) || "{}")
    : {};
  const restore = (kind: MediaKind) => ({
    ...initialDrafts[kind],
    ...saved[kind],
    input: { ...initialDrafts[kind].input, ...saved[kind]?.input },
  });
  return { image: restore("image"), video: restore("video") };
}
function useGenerationState() {
  // The gallery composer's drafts survive a reload, remembered as they change.
  const storageKey = useRememberedKey("composer-draft");
  const [restored] = useState(() => savedDrafts(storageKey));
  const drafts = useRef(restored);
  const form = useForm<Draft>({ mode: "controlled", initialValues: restored.image });
  const draft = form.values;
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(drafts.current));
  }, [draft, storageKey]);
  const formRef = useRef(form);
  formRef.current = form;
  const setDraft = useCallback((value: Draft | ((previous: Draft) => Draft)) => {
    const previous = formRef.current.getValues();
    const next = {
      ...empty,
      ...(typeof value === "function" ? value(previous) : value),
    };
    drafts.current[previous.input.kind] = previous;
    drafts.current[next.input.kind] = next;
    formRef.current.setValues(next);
  }, []);
  const changeKind = useCallback(
    (kind: MediaKind) => {
      if (formRef.current.getValues().input.kind !== kind) setDraft(drafts.current[kind]);
    },
    [setDraft],
  );
  const models = useQuery({ ...modelsQuery, refetchInterval: 15000 });
  const profiles = models.data?.profiles ?? emptyProfiles;
  const selectedProfile = draft.input.profileId
    ? profiles.find((profile) => isProfile(profile, draft.input.profileId))
    : defaultProfile(models.data, draft.input.kind);
  const profile = useMemo(
    () =>
      profileForBackend(
        selectedProfile,
        draft.input.profileBackend,
        Boolean(draft.references.length || draft.input.referenceAssets?.length),
      ),
    [selectedProfile, draft.input.profileBackend, draft.references, draft.input.referenceAssets],
  );
  function update(patch: Partial<GenerationInput>) {
    setDraft((previous) => ({ ...previous, input: { ...previous.input, ...patch } }));
  }
  /** Moves the draft to `profile`: one the person picked, or the account's default (`defaulted`). */
  function selectProfile(profile: Profile, defaulted = false) {
    // The output toggle restores that mode's whole draft, including its chosen profile.
    if (form.getValues().input.kind !== profile.kind) {
      changeKind(profile.kind);
      return;
    }
    setDraft((previous) => ({
      ...previous,
      input: inputForProfile(previous.input, profile),
      operation: profile.kind === "video" ? "animate" : previous.operation,
      defaultedProfileId: defaulted ? profile.id : undefined,
    }));
  }
  return {
    form,
    draft,
    setDraft,
    changeKind,
    input: draft.input,
    update,
    profiles,
    profile,
    models,
    selectProfile,
  };
}
const Context = createContext<ReturnType<typeof useGenerationState> | null>(null);
const GenerationActionsContext = createContext<Pick<
  ReturnType<typeof useGenerationState>,
  "profiles" | "setDraft" | "changeKind"
> | null>(null);
export function GenerationProvider({ children }: { children: ReactNode }) {
  const value = useGenerationState();
  const actions = useMemo(
    () => ({
      profiles: value.profiles,
      setDraft: value.setDraft,
      changeKind: value.changeKind,
    }),
    [value.profiles, value.setDraft, value.changeKind],
  );
  return (
    <GenerationActionsContext.Provider value={actions}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </GenerationActionsContext.Provider>
  );
}
export function useGenerationActions() {
  const context = useContext(GenerationActionsContext);
  if (!context) throw new Error("GenerationProvider is required");
  return context;
}
export function useGeneration() {
  const context = useContext(Context);
  if (!context) throw new Error("GenerationProvider is required");
  return context;
}
