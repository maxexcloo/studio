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
 * were stopped on purpose, so it reads as parked rather than missing.
 */
export function servedChatModels(models, workloads, phases) {
  const stopped = [...new Set(workloads.map((item) => item.model).filter(Boolean))]
    .filter((id) => !models.some((model) => model.id === id))
    .map((id) => ({ id, label: id }));
  return [...models, ...stopped].flatMap((model) => {
    const served = workloads.filter((item) => item.model === model.id).map(({ id }) => id);
    if (!served.length) return [model];
    if (!phases) return [{ ...model, workloads: served }];
    if (served.some((id) => phases[id] === "running")) return [model];
    return served.every((id) => phases[id] === "parked") ? [{ ...model, parked: true }] : [];
  });
}
