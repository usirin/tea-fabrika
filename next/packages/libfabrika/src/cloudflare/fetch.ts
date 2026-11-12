import { Effect } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { GatewayClient, ProjectClient } from "./platform.ts";
import { projectStub, rpc, type BrainOptions, type Env } from "./runtime.ts";

/** A window file as served: its body, its hash for the ETag and its content type (`runtime/Built.ts`'s Asset). */
type Served = { readonly hash: string; readonly type: string; readonly body: string };

/** Answer a request from the brain's embedded window files. Nothing else is read: an unknown route is 404. */
export const serveAsset = Effect.fn("brain.asset")(function* (
  assets: Readonly<Record<string, Served>>,
  request: Request,
) {
  const route = new URL(request.url).pathname;
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
  config: BrainOptions,
  assets?: Readonly<Record<string, Served>>,
) {
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

  // A window file is read by GET or HEAD from the embedded table; an unknown file is 404.
  if (assets !== undefined && url.pathname !== "/" && (request.method === "GET" || request.method === "HEAD")) {
    return yield* serveAsset(assets, request);
  }

  return new Response("fabrika", { headers: { "content-type": "text/plain" } });
});
