import { accountAccessForId } from "./account-store.js";
import { createAssistant } from "./assistant.js";
import { chatModelAllowed, chatSettings, servedChatModels } from "./chat-settings.js";
import { flagEnabled } from "./deployment-settings.js";
import { ChatService } from "./domain/chat.ts";
import { ChatStore } from "./domain/chat-store.ts";
import { publicJob } from "./domain/store.ts";
import { multiUserEnabled } from "./multi-user-auth.js";
import { canonicalProfileId } from "./profile/store.js";
import { referenceExistsForAccount } from "./references.js";

/**
 * Studio Chat's service (domain/chat.ts) wired to the rest of Studio: its store, the in-process
 * MCP agent, taste, the text models it may use, and card revisions checked and admitted as
 * generations. `referenceImage(account, id)` reads a reference for the text model; `validate`
 * and `admit` are the generation queue's own.
 */
export function createSessionChat({
  admit,
  catalogueModels,
  mcp,
  referenceImage,
  runtime,
  store,
  taste,
  tasteWriter,
  validate,
}) {
  /** The catalogue profile a Chat draft names, if any. */
  async function chatProfile(input) {
    const models = await catalogueModels();
    return models.profiles?.find((item) => item.id === canonicalProfileId(input?.profileId));
  }
  async function selectedChatMediaProfile(input, operation) {
    const profile = await chatProfile(input);
    const reject = (message) => {
      throw Object.assign(new Error(message), { status: 400 });
    };
    if (!profile)
      reject("Choose an available generation model before asking Chat to create media.");
    const kind = operation === "animate" ? "video" : "image";
    if ((profile.kind || "image") !== kind)
      reject(
        `Choose a ${kind} model for this action; the selected model will not be changed automatically.`,
      );
    if (
      operation !== "image" &&
      !(
        profile.capabilities?.startImage ||
        profile.imageModes?.reference ||
        profile.mediaInputs?.length
      )
    )
      reject("Choose a model that supports image references for this action.");
    return profile;
  }
  let chatGateway;
  return new ChatService({
    store: new ChatStore(store.db),
    settings: chatSettings,
    // Chat already requires the prompt assistant; the taste writer check keeps the two in step.
    taste: (ownerId) => (tasteWriter(ownerId) ? taste.read(ownerId).summary : ""),
    session: (ownerId, id) => store.session(ownerId, id),
    titles: () => flagEnabled("STUDIO_CHAT_TITLES"),
    // Studio's MCP server for this chat, in process: the tools and rules LibreChat gets.
    agent: (ownerId, sessionId, owned) =>
      mcp.agent({
        owner: ownerId,
        account: ownerId ? accountAccessForId(ownerId) : undefined,
        session: sessionId,
        ...owned,
      }),
    results: (ownerId, sessionId) =>
      store.jobs(ownerId, sessionId).map((job) => ({
        id: job.id,
        status: job.status,
        kind: job.input.kind,
        profile: job.input.profileId,
        prompt: job.input.prompt,
      })),
    // A text workload's model reads images as its workloads say; Bifrost's cloud models all do.
    vision: async (modelId) => {
      const served = (runtime?.controller.workloads || []).filter(
        (item) =>
          item.kind === "text" &&
          item.model &&
          // A workload model without a provider prefix matches only itself, not every model.
          (item.model.includes("/")
            ? modelId.startsWith(item.model.slice(0, item.model.lastIndexOf("/") + 1))
            : modelId === item.model),
      );
      return served.length ? served.every((item) => item.vision === true) : true;
    },
    models: async (ownerId) => {
      const settings = chatSettings();
      if (!settings) return [];
      const account = ownerId ? accountAccessForId(ownerId) : undefined;
      if (ownerId && !account?.authenticated) return [];
      chatGateway ||= createAssistant(process.env, { resolveSettings: chatSettings });
      const models = ((await chatGateway?.listModelDetails()) || []).filter((model) =>
        chatModelAllowed(model.id, settings.patterns),
      );
      const workloads = (runtime?.controller.workloads || []).filter(
        (item) =>
          item.kind === "text" && item.model && chatModelAllowed(item.model, settings.patterns),
      );
      if (!workloads.length) return models;
      // Only administrators may start a stopped model, as in Settings › Workers.
      const admin = !multiUserEnabled || account?.role === "administrator";
      const phases = admin
        ? undefined
        : Object.fromEntries(
            (await runtime.controller.observe()).workloads.map(({ id, phase }) => [id, phase]),
          );
      return servedChatModels(models, workloads, phases);
    },
    revision: async (ownerId, sessionId, revision) => {
      const source = store.job(ownerId, revision.sourceJobId);
      if (!source || source.sessionId !== sessionId)
        throw Object.assign(new Error("Source generation not found."), { status: 404 });
      const account = ownerId ? accountAccessForId(ownerId) : undefined;
      if (ownerId && !account?.authenticated)
        throw Object.assign(new Error("This account is unavailable."), { status: 403 });
      const kind = revision.operation === "animate" ? "video" : "image";
      if (revision.input.kind && revision.input.kind !== kind)
        throw Object.assign(new Error("The selected operation does not match the media kind."), {
          status: 400,
        });
      const input = { ...revision.input, kind };
      const profile = await selectedChatMediaProfile(input, revision.operation);
      const startImage = input.startImageId || input.startImage;
      if (startImage && !referenceExistsForAccount(account, startImage))
        throw Object.assign(new Error("The start image does not belong to this account."), {
          status: 400,
        });
      if (!input.referenceAssets?.length && startImage)
        input.referenceAssets = [
          { assetId: startImage, slot: profile.mediaInputs?.[0]?.id || "reference" },
        ];
      if (revision.operation !== "image" && !input.referenceAssets?.length)
        throw Object.assign(
          new Error("Choose a reference image before submitting a refinement or animation."),
          { status: 400 },
        );
      if (input.referenceAssets !== undefined && !Array.isArray(input.referenceAssets))
        throw Object.assign(new Error("Choose reference images as an array."), { status: 400 });
      for (const reference of input.referenceAssets || [])
        if (
          !reference ||
          typeof reference.assetId !== "string" ||
          !referenceExistsForAccount(account, reference.assetId)
        )
          throw Object.assign(new Error("Choose reference images belonging to this account."), {
            status: 400,
          });
      const checked = await validate(input, account || undefined);
      if (checked.status >= 400)
        throw Object.assign(new Error(checked.payload.error), { status: checked.status });
      return {
        sourceJobId: source.id,
        operation: revision.operation,
        input,
        previousInput: source.input,
      };
    },
    reference: async (ownerId, id) => {
      const account = ownerId ? accountAccessForId(ownerId) : undefined;
      if (ownerId && !account?.authenticated)
        throw Object.assign(new Error("This account no longer has access."), { status: 403 });
      const image = await referenceImage(account, id);
      if (!image)
        throw Object.assign(new Error("This reference image cannot be used by Chat."), {
          status: 400,
        });
      return `data:${image.mime};base64,${image.data}`;
    },
    // A card revision, already checked by `revision`, runs exactly as submitted.
    admit: async ({ ownerId, sessionId, turnId, draft }) => {
      const account = ownerId ? accountAccessForId(ownerId) : undefined;
      if (ownerId && !account?.authenticated)
        throw Object.assign(new Error("This account is unavailable."), { status: 403 });
      const result = await admit(
        {
          ...draft.input,
          kind: draft.operation === "animate" ? "video" : "image",
          clientJobId: turnId,
          allowFallback: draft.input.allowFallback === true,
        },
        account || undefined,
        { sessionId, operation: draft.operation, parentJobId: draft.parentJobId },
      );
      if (result.status >= 400)
        throw Object.assign(new Error(result.payload.error || "Generation could not be started."), {
          status: result.status,
        });
      return { job: publicJob(store.job(ownerId, result.payload.jobId)) };
    },
  });
}
