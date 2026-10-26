/**
 * AI Control, the service that decides by hand which workload each GPU runs.
 * Only the AI Control MCP tools (CONTROL_MCP_API_KEY) use this client; Studio's
 * own interface has no AI Control panel, as GPU allocation stays in AI
 * Control's own UI and Mise. Studio reaches it
 * with CONTROL_URL and CONTROL_API_KEY from the server environment only: the
 * key never reaches a browser, and a browser's cookies and headers never
 * reach AI Control.
 */

class ControlError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function controlConfigured(environment = process.env) {
  return Boolean(environment.CONTROL_URL && environment.CONTROL_API_KEY);
}

/** AI Control's own words for a refusal it explains (a stale preview, a change already running), never anything Studio sent. */
function refusal(status, data, text, key) {
  if (status === 401 || status === 403) return "AI Control refused Studio’s key.";
  if (![400, 404, 409].includes(status)) return "AI Control couldn’t do that right now.";
  const said =
    typeof data?.error === "string"
      ? data.error
      : typeof text === "string" && !text.trimStart().startsWith("<")
        ? text
        : "";
  const line = said.replace(/\s+/g, " ").trim().slice(0, 240);
  return (key && line.includes(key) ? "" : line) || "AI Control refused the request.";
}

/**
 * `control(method, route, body)` asks AI Control's `/api/{route}` and resolves
 * to its JSON, or throws a ControlError with a status and a message that is
 * safe to show.
 */
export function createControlClient(
  environment = process.env,
  fetchImpl = fetch,
  { timeoutMs = 15000 } = {},
) {
  return async (method, route, body) => {
    if (!controlConfigured(environment)) throw new ControlError("AI Control isn’t connected.", 503);
    let response;
    try {
      response = await fetchImpl(`${environment.CONTROL_URL.replace(/\/+$/, "")}/api/${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${environment.CONTROL_API_KEY}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ControlError("AI Control is unavailable.", 502);
    }
    const text = await response.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    if (response.ok) {
      if (data === null)
        throw new ControlError("AI Control sent an answer Studio can’t read.", 502);
      return data;
    }
    throw new ControlError(
      refusal(response.status, data, text, environment.CONTROL_API_KEY),
      response.status === 401 || response.status === 403
        ? 502
        : response.status >= 500
          ? 502
          : response.status,
    );
  };
}
