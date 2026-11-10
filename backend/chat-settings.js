import { gatewayAddress } from "./assistant.js";

/** Chat talks to the assistant's gateway (STUDIO_ASSISTANT_URL, _KEY) with its own model allowlist. */
export function chatSettings(environment = process.env) {
  const [url, credential, allowed] = [
    "STUDIO_ASSISTANT_URL",
    "STUDIO_ASSISTANT_KEY",
    "STUDIO_CHAT_MODELS",
  ].map((name) => String(environment[name] || "").trim());
  if (!allowed) return null;
  if (!url || !credential)
    throw Object.assign(new Error("Chat needs STUDIO_ASSISTANT_URL and STUDIO_ASSISTANT_KEY."), {
      status: 503,
    });
  const patterns = allowed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !patterns.length ||
    patterns.some((pattern) => pattern.includes("*") && pattern.indexOf("*") !== pattern.length - 1)
  )
    throw Object.assign(
      new Error(
        "STUDIO_CHAT_MODELS needs comma-separated exact model IDs or prefixes ending in *.",
      ),
      { status: 503 },
    );
  try {
    return { ...gatewayAddress(url, "STUDIO_ASSISTANT_URL"), key: credential, model: "", patterns };
  } catch (error) {
    throw Object.assign(error, { status: 503 });
  }
}

export function chatModelAllowed(id, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
  );
}

/**
 * Names the text workloads serving each model, adding workload models the gateway leaves out
 * while they are stopped. With `phases` (an account that may not start workloads), a
 * workload-served model is listed while one of its workloads runs, and marked `parked` while all
 * were stopped on purpose, so it reads as parked rather than missing. Workload models the gateway
 * leaves out are `local`.
 */
export function servedChatModels(models, workloads, phases) {
  const stopped = [...new Set(workloads.map((item) => item.model).filter(Boolean))]
    .filter((id) => !models.some((model) => model.id === id))
    .map((id) => ({ id, label: id, local: true }));
  return [...models, ...stopped].flatMap((model) => {
    const served = workloads.filter((item) => item.model === model.id).map(({ id }) => id);
    if (!served.length) return [model];
    if (!phases) return [{ ...model, workloads: served }];
    if (served.some((id) => phases[id] === "running")) return [model];
    return served.every((id) => phases[id] === "parked") ? [{ ...model, parked: true }] : [];
  });
}

/**
 * Chat's model where the person picked none: the first that can answer now (`ready`) on the side
 * the account's Chat preference chooses (`prefer`, account-preferences.js; Local unless Cloud),
 * otherwise the first on the other side, with a `note` saying so; with neither, the first listed.
 * Local models carry `local` (chat-service.js).
 */
export function preferredChatModel(models, prefer, ready = (model) => !model.parked) {
  const cloudFirst = prefer === "cloud";
  const first = (cloud) => models.find((model) => !model.local === cloud && ready(model));
  const preferred = first(cloudFirst);
  if (preferred) return { id: preferred.id, note: "" };
  const other = first(!cloudFirst);
  if (!other) return { id: models[0]?.id, note: "" };
  return {
    id: other.id,
    note: cloudFirst
      ? "No cloud text model is available, so a local one answered."
      : "No local text model is running, so a cloud one answered.",
  };
}
