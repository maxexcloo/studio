import type { DomainResponse, GenerationAccount } from "./admission.ts";

/** The signed-in account a route answers, as multi-user-auth.js finds it; none in single-user mode. */
export type RouteAccount = GenerationAccount | null | undefined;
/** What a route reads of its request: Express's request has these, and MCP passes them in process. */
export interface RouteInput {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body?: any;
  /** Ends work the caller no longer waits for, where a route sets it up (the assistant's). */
  stop?: AbortSignal;
}
/** A route's answer: JSON, or a file's bytes with any headers of its own. */
export type RouteAnswer =
  | DomainResponse
  | { status: number; content: Buffer; mime: string; headers?: Record<string, string> };
export type RouteRun = (
  account: RouteAccount,
  input: RouteInput,
) => RouteAnswer | Promise<RouteAnswer>;
interface Request extends RouteInput {
  studioAccount?: RouteAccount;
}
interface Response {
  set(headers: Record<string, string>): unknown;
  status(code: number): {
    json(value: unknown): unknown;
    type(mime: string): { send(value: Buffer): unknown };
  };
}
type Register = (path: string, handler: (req: Request, res: Response) => unknown) => unknown;
interface DirectRoute {
  method: string;
  pattern: RegExp;
  names: string[];
  run: RouteRun;
}

const tables = new WeakMap<object, DirectRoute[]>();

/**
 * A route the HTTP API and MCP share: `run(account, { params, query, body })` answers it, the HTTP
 * handler only sends that answer, and MCP calls `run` in process (mcp/studio-requests.js) after the
 * same access checks the request would have met.
 */
export function directRoute(app: object, method: string, path: string, run: RouteRun) {
  const names: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:(\w+)/g, (_, name: string) => (names.push(name), "([^/]+)"))}$`,
  );
  const table = tables.get(app) || [];
  tables.set(app, table);
  table.push({ method, pattern, names, run });
  (app as Record<string, Register | undefined>)[method.toLowerCase()]?.(path, async (req, res) => {
    const answer = await run(req.studioAccount, req);
    if ("content" in answer) {
      if (answer.headers) res.set(answer.headers);
      return res.status(answer.status).type(answer.mime).send(answer.content);
    }
    return res.status(answer.status).json(answer.payload);
  });
}

/** The shared route `method` and `path` reach on `app`, with its decoded parameters. */
export function findDirectRoute(app: object, method: string, path: string) {
  for (const route of tables.get(app) || []) {
    const match = route.method === method && route.pattern.exec(path);
    if (match)
      return {
        run: route.run,
        params: Object.fromEntries(
          route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
        ),
      };
  }
  return null;
}
