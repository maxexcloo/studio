/**
 * MCP's in-process Studio calls (McpMedia's `domainRequest`, mcp/studio-requests.js) answered by a
 * test's fake Studio routes at `base()`. Each call names its credential as the fakes read it: a
 * personal token as its bearer, Studio's own credential as the account it acts for.
 */
export function fakeStudio(base) {
  return async (method, route, body, owner, credential) => {
    const response = await fetch(new URL(route, base()), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(credential?.token ? { Authorization: `Bearer ${credential.token}` } : {}),
        ...(credential?.internal ? { "X-Studio-Account": owner } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = response.headers.get("content-type") || "";
    if (type.startsWith("application/json"))
      return { status: response.status, payload: await response.json() };
    return {
      status: response.status,
      content: Buffer.from(await response.arrayBuffer()),
      mime: type.split(";")[0],
      headers: Object.fromEntries(response.headers),
    };
  };
}
