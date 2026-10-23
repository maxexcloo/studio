import { lazy, Suspense, useEffect, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Tooltip,
  Alert,
  AspectRatio,
  Badge,
  Button,
  Checkbox,
  Group,
  Image,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  type NumberInputProps,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ArrowUp, SlidersHorizontal } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, failure, post } from "../../api";
import type { GenerationInput, Session } from "../../types";
import { useGeneration } from "./GenerationProvider";
import { LoadingState } from "../../ui/LoadingState";
import { ProfilePicker } from "./ProfilePicker";
import { LoraPicker } from "./LoraPicker";
import { PresetEditor } from "./PresetEditor";
import { GenerationFooter } from "./GenerationFooter";
import { SizePicker } from "./SizePicker";
import { generationInput, referenceDetails, primaryReference, referencePatch } from "./payload";
import { ReferenceRoleControl } from "./ReferenceRoleControl";
import { ReferencePicker } from "./ReferencePicker";
const MaskEditor = lazy(() => import("./MaskEditor"));

export function GenerationForm({
  onSubmitted,
  compact = false,
  onControls,
  autoFocusPrompt = false,
}: {
  onSubmitted?: () => void;
  compact?: boolean;
  onControls?: () => void;
  autoFocusPrompt?: boolean;
}) {
  const { form, draft, setDraft, input, update, profile, profiles, selectProfile, models } =
    useGeneration();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [maskOpen, setMaskOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const narrow = useMediaQuery("(max-width:48em)", false, { getInitialValueInEffect: false });
  const assistant = useQuery({
    queryKey: ["assistant"],
    queryFn: () =>
      api<{
        available: boolean;
        defaultPreset: string;
        presets: { id: string; label?: string; name?: string }[];
      }>("/api/assistant"),
  });
  const [assistantPreset, setAssistantPreset] = useState<string | null>(null);
  useEffect(() => {
    if (!input.profileId && profile) selectProfile(profile);
  }, [input.profileId, profile]);
  const submit = useMutation({
    mutationFn: async () => {
      if (form.validate().hasErrors) throw new Error("Describe what you want to create.");
      if (!profile) throw new Error("Choose an available model first.");
      const payload = {
        ...generationInput(input, profile, draft.references),
        operation: draft.operation,
        parentJobId: draft.parentJobId,
      };
      let sessionId = draft.sessionId;
      if (!sessionId) {
        const result = await post<{ session: Session }>("/api/sessions", {
          title: input.prompt.slice(0, 80),
          inputs: payload,
        });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
      }
      await post(`/api/sessions/${sessionId}/generations`, payload);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      void client.invalidateQueries({ queryKey: ["session", sessionId] });
      onSubmitted?.();
      if (!["/images", "/video"].includes(location.pathname)) navigate(`/chat/${sessionId}`);
    },
    onError: failure,
  });
  const rewrite = useMutation({
    mutationFn: () =>
      post<{ prompt: string; source?: string; reason?: string }>("/api/assistant/rewrite", {
        profileId: profile?.id,
        prompt: input.prompt,
        preset: assistantPreset || assistant.data?.defaultPreset,
        stream: false,
        loras: input.loras.map((l) => l.name),
      }),
    onSuccess: (result) => {
      if (result.source === "fallback")
        return failure(result.reason || "Prompt assistance is unavailable.");
      update({ prompt: result.prompt });
    },
    onError: failure,
  });
  const number = (key: keyof GenerationInput, label: string, props: NumberInputProps = {}) => (
    <NumberInput
      key={key}
      label={label}
      value={Number(input[key])}
      onChange={(value) => update({ [key]: value })}
      {...props}
      min={profile?.constraints?.[String(key)]?.min ?? props.min}
      max={profile?.constraints?.[String(key)]?.max ?? props.max}
      step={profile?.constraints?.[String(key)]?.step ?? props.step}
    />
  );
  const requiredReference = profile?.mediaInputs?.some(
    (slot) =>
      slot.required &&
      !referenceDetails(draft.references, input, profile).some((asset) => asset.slot === slot.id) &&
      !input.referenceAssets.some((asset) => asset.slot === slot.id),
  );
  function keyboardSubmit(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    if (
      submit.isPending ||
      !profile ||
      profile.ready === false ||
      !input.prompt.trim() ||
      requiredReference
    )
      return;
    event.currentTarget.requestSubmit();
  }
  const primary = primaryReference(referenceDetails(draft.references, input, profile), profile);
  const inpaint = input.inpaint as
    | { assetId?: string; mask?: string; strength?: number; feather?: number }
    | undefined;
  const submitLabel =
    draft.operation === "refine"
      ? "Refine Image"
      : input.kind === "video"
        ? "Generate Video"
        : "Generate Image";
  if (!compact && narrow && referenceOpen)
    return <ReferencePicker inline opened onOpenedChange={setReferenceOpen} />;
  if (compact)
    return (
      <form
        onKeyDown={keyboardSubmit}
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <Group wrap="nowrap" gap="xs" className="studio-compact-composer">
          <ReferencePicker compact />
          <Textarea
            data-composer-prompt
            aria-label="Prompt"
            placeholder={input.kind === "video" ? "Describe the motion…" : "Describe your image…"}
            autosize
            minRows={1}
            maxRows={1}
            variant="unstyled"
            className="studio-compact-prompt"
            value={input.prompt}
            onChange={(event) => update({ prompt: event.currentTarget.value })}
            required
          />
          <Tooltip label={profile?.displayName || profile?.label || "Generation Inputs"}>
            <ActionIcon
              data-generation-controls
              aria-label="Generation Inputs"
              variant="subtle"
              color="gray"
              size={38}
              onClick={onControls}
            >
              <SlidersHorizontal size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={submitLabel}>
            <ActionIcon
              type="submit"
              aria-label={submitLabel}
              className="studio-generate-button"
              size={44}
              radius="xl"
              variant="filled"
              loading={submit.isPending}
              disabled={
                !profile || profile.ready === false || !input.prompt.trim() || requiredReference
              }
            >
              <ArrowUp size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {!!submit.error && (
          <Text c="red" size="xs">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Text>
        )}
      </form>
    );
  if (models.isPending) return <LoadingState label="Loading Profiles" />;
  return (
    <form
      onKeyDown={keyboardSubmit}
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>Create</Text>
          <Badge variant="light">
            {draft.operation === "image"
              ? "New Image"
              : draft.operation === "refine"
                ? "Refine"
                : "Animate"}
          </Badge>
        </Group>
        <ProfilePicker />
        {profile?.ready === false && (
          <Alert color="yellow">
            This model needs additional files or worker nodes before it can run.
          </Alert>
        )}
        {!models.isPending && !profile && (
          <Alert color="yellow">
            {input.profileId && profiles.length
              ? "The selected profile is unavailable. Choose another model explicitly."
              : "No models are available. Check your worker and mounted configuration."}
          </Alert>
        )}
        {models.error && <Alert color="red">{models.error.message}</Alert>}
        <Textarea
          data-expanded-prompt
          data-autofocus={autoFocusPrompt || undefined}
          label="Prompt"
          placeholder={
            input.kind === "image"
              ? "Describe the image you want to create…"
              : "Describe the motion and camera…"
          }
          autosize
          minRows={5}
          maxRows={12}
          value={input.prompt}
          onChange={(event) => update({ prompt: event.currentTarget.value })}
          required
        />
        {assistant.data?.available && (
          <Group grow>
            <Select
              aria-label="Prompt Assistance Style"
              placeholder="Assistance Style"
              data={assistant.data.presets.map((p) => ({
                value: p.id,
                label: p.label || p.name || p.id,
              }))}
              value={assistantPreset || assistant.data.defaultPreset}
              onChange={setAssistantPreset}
            />
            <Button
              variant="default"
              loading={rewrite.isPending}
              disabled={!input.prompt.trim()}
              onClick={() => rewrite.mutate()}
            >
              Improve Prompt
            </Button>
          </Group>
        )}
        {profile?.capabilities?.negativePrompt !== false && (
          <Textarea
            label="Negative Prompt"
            autosize
            minRows={2}
            value={input.negative}
            onChange={(e) => update({ negative: e.currentTarget.value })}
          />
        )}
        {profile?.mediaInputs?.length ||
        profile?.capabilities?.img2img ||
        profile?.capabilities?.imageInput ? (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                References
              </Text>
              <ReferencePicker opened={referenceOpen} onOpenedChange={setReferenceOpen} />
            </Group>
            {!!draft.references.length && (
              <ReferenceRoleControl
                value={input.referenceRole}
                onChange={(referenceRole) => update({ referenceRole })}
              />
            )}
            {draft.references.map((asset) => (
              <Paper withBorder key={`${asset.slot}:${asset.id}`} p="xs">
                <Group wrap="nowrap">
                  <AspectRatio ratio={1} w={52}>
                    <Image src={asset.thumbnailUrl} alt={asset.name} fallbackSrc="" />
                  </AspectRatio>
                  <Text size="sm" lineClamp={1} flex={1}>
                    {asset.name}
                    {asset.slot
                      ? ` · ${profile?.mediaInputs?.find((slot) => slot.id === asset.slot)?.label || asset.slot}`
                      : ""}
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      setDraft((value) => {
                        const references = value.references.filter(
                          (a) => a.id !== asset.id || a.slot !== asset.slot,
                        );
                        return {
                          ...value,
                          references,
                          input: {
                            ...value.input,
                            ...referencePatch(value.input, value.references, references, profile),
                          },
                        };
                      })
                    }
                  >
                    Remove
                  </Button>
                </Group>
              </Paper>
            ))}
            {requiredReference && (
              <Text size="xs" c="dimmed">
                This workflow requires a reference image.
              </Text>
            )}
            {primary && profile?.capabilities?.inpaint && (
              <Group>
                <Button variant="default" size="compact-sm" onClick={() => setMaskOpen(true)}>
                  {input.inpaint ? "Edit Mask" : "Paint Mask"}
                </Button>
                {!!input.inpaint && (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => update({ inpaint: null })}
                  >
                    Remove Mask
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        ) : null}
        <SizePicker input={input} profile={profile} onChange={update} />
        <Accordion variant="separated" transitionDuration={0}>
          <Accordion.Item value="expert">
            <Accordion.Control>Expert Controls</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <SimpleGrid cols={2}>
                  {number("steps", "Steps", { min: 1, max: 200 })}
                  {profile?.capabilities?.cfg !== false &&
                    number("cfg", "Guidance", { min: 0, max: 30, step: 0.5 })}
                  {number("count", "Count", { min: 1, max: 8 })}
                  {number("denoise", "Denoise", { min: 0, max: 1, step: 0.05 })}
                </SimpleGrid>
                <TextInput
                  label="Seed"
                  description="Leave blank for a random seed."
                  value={String(input.seed)}
                  onChange={(e) => update({ seed: e.currentTarget.value })}
                />
                {input.kind === "video" && (
                  <SimpleGrid cols={2}>
                    {number("fps", "FPS", { min: 1, max: 120 })}
                    {number("frames", "Frames", { min: 1 })}
                    {number("duration", "Duration (Seconds)", { min: 1 })}
                  </SimpleGrid>
                )}
                {["samplers", "schedulers", "textEncoders", "vaes", "resolutions"].map((key) =>
                  profile?.options?.[key]?.length ? (
                    <Select
                      key={key}
                      label={
                        {
                          samplers: "Sampler",
                          schedulers: "Scheduler",
                          textEncoders: "Text Encoder",
                          vaes: "VAE",
                          resolutions: "Resolution",
                        }[key]
                      }
                      data={profile.options[key]}
                      value={String(
                        input[
                          {
                            samplers: "sampler",
                            schedulers: "scheduler",
                            textEncoders: "textEncoder",
                            vaes: "vae",
                            resolutions: "resolution",
                          }[key]!
                        ] || "",
                      )}
                      onChange={(value) =>
                        update({
                          [{
                            samplers: "sampler",
                            schedulers: "scheduler",
                            textEncoders: "textEncoder",
                            vaes: "vae",
                            resolutions: "resolution",
                          }[key]!]: value,
                        })
                      }
                    />
                  ) : null,
                )}
                {profile?.capabilities?.lora && <LoraPicker />}
                {profile?.provider !== "cliproxyapi" && (
                  <Checkbox
                    label="Allow Fallback to Another Worker"
                    description="Studio waits for the selected backend unless you allow another."
                    checked={Boolean(input.allowFallback)}
                    onChange={(e) => update({ allowFallback: e.currentTarget.checked })}
                  />
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="presets">
            <Accordion.Control>Saved Presets</Accordion.Control>
            <Accordion.Panel>
              <PresetEditor />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {!!submit.error && (
          <Alert color="red">
            {submit.error instanceof Error ? submit.error.message : String(submit.error)}
          </Alert>
        )}
        <GenerationFooter
          kind={input.kind}
          onKindChange={(kind) => {
            const next = profiles.find((profile) => profile.kind === kind);
            if (next) selectProfile(next);
            else update({ kind, profileId: "" });
          }}
          onClear={() =>
            setDraft((previous) => ({
              ...previous,
              references: [],
              input: {
                ...previous.input,
                prompt: "",
                negative: "",
                referenceAssets: [],
                referenceDetails: [],
                inpaint: undefined,
              },
            }))
          }
        >
          <Button
            type="submit"
            rightSection={<ArrowUp size={18} />}
            size="sm"
            loading={submit.isPending}
            disabled={
              !profile ||
              profile.ready === false ||
              !input.prompt.trim() ||
              requiredReference ||
              rewrite.isPending
            }
          >
            {draft.operation === "refine"
              ? "Refine Image"
              : input.kind === "video"
                ? "Generate Video"
                : "Generate Image"}
          </Button>
        </GenerationFooter>
        <Text size="xs" c="dimmed">
          Inputs and results are saved together in a session.
        </Text>
        {maskOpen && primary && (
          <Suspense fallback={null}>
            <MaskEditor
              key={primary.id}
              asset={primary}
              initialMask={
                !inpaint?.assetId || inpaint.assetId === primary.id ? inpaint?.mask : undefined
              }
              close={() => setMaskOpen(false)}
              save={(mask) =>
                update({
                  inpaint: {
                    ...inpaint,
                    mask,
                    assetId: primary.id,
                    strength: inpaint?.strength ?? 1,
                    feather: inpaint?.feather ?? 8,
                  },
                })
              }
            />
          </Suspense>
        )}
      </Stack>
    </form>
  );
}
