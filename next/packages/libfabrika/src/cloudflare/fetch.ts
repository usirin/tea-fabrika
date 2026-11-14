import { Context, Effect, Layer } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { RecordedStart } from "../settings/RecordedStart.ts";
import { GatewayClient, ProjectClient } from "./platform.ts";
import { projectStub, recordedLayer, rpc, type BrainOptions, type Env } from "./runtime.ts";

// Worker bindings are immutable for an isolate, so a recorded start is kept by its `env` object. Only a
// finished read is kept, never one still under way: the platform gives each request to a Worker its own
// I/O context, and cancels as hung a request that waits on work another request started.
const isolates = new WeakMap<Env, Context.Context<RecordedStart>>();

/**
 * Returns the effect that gives the Worker's `RecordedStart` context, read on first use.
 *
 * **Details**
 *
 * One context is kept per `env` object once a read has finished, and later uses get that same
 * context with no call. A request that arrives before any read has finished reads for itself:
 * recording the same start again answers the first receipt, so every such read gives the same
 * start. A failed read is not kept: the next use tries again.
 *
 * @stability unstable
 * @category getters
 */
export const httpContext = (env: Env) =>
  Effect.suspend(() => {
    const known = isolates.get(env);

    return known !== undefined
      ? Effect.succeed(known)
      : // `RecordedStart` is a plain value with nothing to give back, so it outlives this scope.
        Layer.build(recordedLayer(env)).pipe(
          Effect.scoped,
          Effect.tap((context) => Effect.sync(() => isolates.set(env, context))),
        );
  });

/** The tab's page in the window table, answered at `/` (P14). */
const PAGE = "/index.html";

/** A window file as served: its body, its hash for the ETag and its content type (`runtime/Built.ts`'s Asset). */
type Served = { readonly hash: string; readonly type: string; readonly body: string };

/** Answer a request from the brain's embedded window files. Nothing else is read: an unknown route is 404.
 *  `route` is the request's path unless given. */
export const serveAsset = Effect.fn("brain.asset")(function* (
  assets: Readonly<Record<string, Served>>,
  request: Request,
  route = new URL(request.url).pathname,
) {
  const asset = Object.hasOwn(assets, route) ? assets[route] : undefined;
  yield* Effect.annotateCurrentSpan({
    "asset.found": asset !== undefined,
    "http.method": request.method,
  });

  if (asset === undefined) {
    return new Response("Not found", { status: 404 });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  return new Response(request.method === "HEAD" ? null : asset.body, {
    headers: { "content-type": asset.type, etag: `"${asset.hash}"` },
  });
});

/** The brain's request handling. `assets` is the embedded window table the brain file carries. */
export const fetch = Effect.fn("workers.fetch")(function* (
  request: Request,
  env: Env,
  _config?: BrainOptions,
  assets?: Readonly<Record<string, Served>>,
) {
  const start = Context.get(yield* httpContext(env), RecordedStart);
  const config = { ...start.input, port: start.values.port };
  const url = new URL(request.url),
    origin = `http://127.0.0.1:${config.port}`;

  if (request.headers.get("host") !== new URL(origin).host) {
    return new Response("Wrong host", { status: 421 });
  }

  if (request.headers.get("origin") !== null && request.headers.get("origin") !== origin) {
    return new Response("Foreign origin", { status: 403 });
  }

  if (url.pathname.startsWith("/client/")) {
    return yield* rpc(GatewayClient.make(env.CONNECTION.getByName(url.pathname)).fetch(request));
  }

  const project = ProjectClient.make(projectStub(env, config.name));

  if (url.pathname === "/grant" && request.method === "POST") {
    // oxlint-disable-next-line fabrika/no-promises -- edge: Request JSON body enters Effect
    const input = yield* Effect.tryPromise({ try: () => request.json(), catch: () => null });
    return Response.json(yield* rpc(project.grant(input)));
  }

  if (url.pathname.startsWith("/grant/client/") && request.method === "GET") {
    const target = yield* Effect.try({
      try: () => decodeURIComponent(url.pathname.slice("/grant/client/".length)),
      catch: (cause) => new LedgerError({ reason: "bad_row", cause }),
    });
    return Response.json(yield* rpc(project.target(target, url.searchParams.get("code") ?? "")));
  }

  // A window file is read by GET or HEAD from the embedded table; an unknown file is 404. `/` is the
  // tab's page when the build made one (P14), else the plain answer.
  if (assets !== undefined && (request.method === "GET" || request.method === "HEAD")) {
    if (url.pathname !== "/") {
      return yield* serveAsset(assets, request);
    }

    if (Object.hasOwn(assets, PAGE)) {
      return yield* serveAsset(assets, request, PAGE);
    }
  }

  return new Response("fabrika", { headers: { "content-type": "text/plain" } });
});
