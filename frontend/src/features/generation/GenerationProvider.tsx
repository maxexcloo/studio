import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { profileStartingSize } from "../../../../shared/resolution";
import { api } from "../../api";
import type { GenerationInput, MediaKind, Models, Profile, ReferenceAsset } from "../../types";
import { useRememberedKey } from "../auth/useRemembered";
import { withLength } from "./length";
import { setFamilyLabels } from "./modelFamily";
import { isProfile, profileForBackend, referencePatch } from "./payload";

export async function fetchModels(cached: boolean) {
  const models = await api<Models>(cached ? "/api/models?cached=1" : "/api/models");
  setFamilyLabels(models.familyLabels);
  return models;
}
export const modelsQuery = queryOptions({
  queryKey: ["models"],
  queryFn: () => fetchModels(true),
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
/** A draft on `profile` at its own starting size and Studio's Video Length, keeping the prompt and references. */
export function inputForProfile(previous: GenerationInput, profile: Profile): GenerationInput {
  const input: GenerationInput = {
    ...initialInput,
    ...profile.defaults,
    ...profileStartingSize(profile),
    prompt: previous.prompt,
    cardParts: previous.cardParts,
    negative: previous.negative,
    referenceAssets: previous.referenceAssets,
    referenceDetails: previous.referenceDetails,
    kind: profile.kind,
    profileId: profile.id,
    model: profile.model,
    workflow: profile.workflow,
    loras: previous.loras,
  };
  return withLength(input, profile, profile.videoPreference?.videoSeconds);
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
   * A comparison being set up (features/compare/variants.ts). Every variant runs on the draft's own
   * settings, changing only what is compared.
   */
  compare?: Comparing;
}
/** One compared variant's settings, as it runs. */
export interface Variant {
  input: GenerationInput;
  references: ReferenceAsset[];
  label?: string;
}
/**
 * What a comparison varies: seeds after the draft's own, each line of the prompt, models beside
 * the draft's, LoRAs added to its stack, one LoRA's strengths or sizes; or set variants (Compare
 * Again, Vary), each changing the draft as recorded, the first being the draft itself.
 */
export type Comparing =
  | { axis: "Seed"; seeds: string[] }
  | { axis: "Prompt" }
  | { axis: "Model"; profileIds: string[] }
  | { axis: "LoRA"; loras: { name: string; strength: number }[]; without: boolean }
  | { axis: "LoRA Strength"; lora: string; strengths: number[] }
  | { axis: "Resolution"; sizes: string[]; native: boolean }
  | {
      axis?: undefined;
      variants: {
        changes: Partial<GenerationInput>;
        references?: ReferenceAsset[];
        label?: string;
      }[];
    };
export type CompareAxis = NonNullable<Comparing["axis"]>;
/**
 * The draft moved to `profile` for a picked character (CharacterChoices): the profile's settings,
 * the prompt led by the character, and its references placed for that profile.
 */
export function draftForProfile(
  previous: Draft,
  profile: Profile,
  next: { references: ReferenceAsset[]; prompt: string; cardParts?: GenerationInput["cardParts"] },
): Draft {
  const input = {
    ...inputForProfile(previous.input, profile),
    prompt: next.prompt,
    cardParts: next.cardParts,
  };
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
/** Starts from saved input without inheriting a run's lineage or comparison. */
export function draftForInput(
  input: GenerationInput,
  selection: Pick<Draft, "presetId" | "presetTitle"> = {},
): Draft {
  return {
    ...empty,
    ...selection,
    input: { ...initialInput, ...input },
    operation: input.kind === "video" ? "animate" : "image",
    references: input.referenceDetails || [],
  };
}
const emptyProfiles: Profile[] = [];
const initialDrafts: Record<MediaKind, Draft> = {
  image: empty,
  video: { ...empty, input: { ...initialInput, kind: "video" }, operation: "animate" },
};
/** The gallery composer's image and video drafts as last saved for this account, over the defaults. */
function savedDrafts(key: string): Record<MediaKind, Draft> {
  const saved: Partial<Record<MediaKind, Draft>> = JSON.parse(localStorage.getItem(key) || "{}");
  const restore = (kind: MediaKind) => ({
    ...initialDrafts[kind],
    ...saved[kind],
    input: { ...initialDrafts[kind].input, ...saved[kind]?.input },
  });
  return { image: restore("image"), video: restore("video") };
}
/** The draft's text, which typing changes. */
const textFields = ["prompt", "negative"] as const;
const differs = <T extends object>(a: T, b: T, skip: readonly string[]) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].some(
    (key) => !skip.includes(key) && a[key as keyof T] !== b[key as keyof T],
  );
/**
 * The composer's draft. `settled` is the draft as typing leaves it: the same object until
 * something other than its text changes, with its text read from the latest draft.
 */
function draftStore(initial: Draft) {
  let draft = initial;
  let settled: Draft | undefined;
  const settledInputs = new WeakSet<GenerationInput>();
  // A settled input given back is copied, so the draft never holds text that follows another.
  const plain = (input: GenerationInput) => (settledInputs.has(input) ? { ...input } : input);
  const listeners = new Set<() => void>();
  function settle() {
    if (
      settled &&
      !differs(settled, draft, ["input"]) &&
      !differs(settled.input, draft.input, textFields)
    )
      return;
    const input = { ...draft.input };
    for (const field of textFields)
      Object.defineProperty(input, field, { enumerable: true, get: () => draft.input[field] });
    settledInputs.add(input);
    settled = { ...draft, input };
  }
  settle();
  return {
    get: () => draft,
    settled: () => settled as Draft,
    set(next: Draft) {
      draft = { ...next, input: plain(next.input) };
      settle();
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
type DraftStore = ReturnType<typeof draftStore>;
function useGenerationState() {
  // The gallery composer's drafts survive a reload, remembered as they change.
  const storageKey = useRememberedKey("composer-draft");
  const [restored] = useState(() => savedDrafts(storageKey));
  const drafts = useRef(restored);
  const [store] = useState(() => draftStore(restored.image));
  const draft = useSyncExternalStore(store.subscribe, store.settled);
  const setDraft = useCallback(
    (value: Draft | ((previous: Draft) => Draft)) => {
      const previous = store.get();
      store.set({ ...empty, ...(typeof value === "function" ? value(previous) : value) });
      const next = store.get();
      drafts.current[previous.input.kind] = previous;
      drafts.current[next.input.kind] = next;
      localStorage.setItem(storageKey, JSON.stringify(drafts.current));
    },
    [store, storageKey],
  );
  const changeKind = useCallback(
    (kind: MediaKind) => {
      if (store.get().input.kind !== kind) setDraft(drafts.current[kind]);
    },
    [store, setDraft],
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
  const update = useCallback(
    (patch: Partial<GenerationInput>) =>
      setDraft((previous) => ({ ...previous, input: { ...previous.input, ...patch } })),
    [setDraft],
  );
  /** Moves the draft to `profile`: one the person picked, or the account's default (`defaulted`). */
  const selectProfile = useCallback(
    (profile: Profile, defaulted = false) => {
      // The output toggle restores that mode's whole draft, including its chosen profile.
      if (store.get().input.kind !== profile.kind) {
        changeKind(profile.kind);
        return;
      }
      setDraft((previous) => ({
        ...previous,
        input: inputForProfile(previous.input, profile),
        operation: profile.kind === "video" ? "animate" : previous.operation,
        defaultedProfileId: defaulted ? profile.id : undefined,
      }));
    },
    [store, changeKind, setDraft],
  );
  const draftForKind = useCallback((kind: MediaKind) => drafts.current[kind], []);
  const value = useMemo(
    () => ({
      /** The draft as it is now, for actions rather than rendering. */
      getDraft: store.get,
      draftForKind,
      setDraft,
      changeKind,
      update,
      profiles,
      profile,
      models,
      selectProfile,
    }),
    [store, draftForKind, setDraft, changeKind, update, profiles, profile, models, selectProfile],
  );
  return { store, value };
}
type Generation = ReturnType<typeof useGenerationState>["value"];
const DraftContext = createContext<DraftStore | null>(null);
const Context = createContext<Generation | null>(null);
const GenerationActionsContext = createContext<Pick<
  Generation,
  "profiles" | "setDraft" | "changeKind"
> | null>(null);
export function GenerationProvider({ children }: { children: ReactNode }) {
  const { store, value } = useGenerationState();
  const actions = useMemo(
    () => ({
      profiles: value.profiles,
      setDraft: value.setDraft,
      changeKind: value.changeKind,
    }),
    [value.profiles, value.setDraft, value.changeKind],
  );
  return (
    <DraftContext.Provider value={store}>
      <GenerationActionsContext.Provider value={actions}>
        <Context.Provider value={value}>{children}</Context.Provider>
      </GenerationActionsContext.Provider>
    </DraftContext.Provider>
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
/**
 * The composer's draft. Unless `live`, typing a prompt doesn't render the caller: the draft
 * changes only when something else does, though its text always reads the latest.
 */
export function useDraft(live = false) {
  const store = useContext(DraftContext);
  if (!store) throw new Error("GenerationProvider is required");
  return useSyncExternalStore(store.subscribe, live ? store.get : store.settled);
}
