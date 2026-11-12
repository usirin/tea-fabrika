// P14 slice 1, next/ (ticket 698): the Worker serves a built tab's page at `/` (S1.3). Later slices
// add the control and bootstrap laws here.
//
// The shape this law holds the code to, from the approved plan: `fetch(request, env, config, assets)`
// takes P16's table of window files by route, each `{hash, type, body}`. The page is the asset at
// `/index.html`. `GET` or `HEAD /` answers it with its type and ETag when the table holds it, and
// the plain answer when it does not. Every other route, the Host and Origin checks first, HEAD
// without a body, the ETag of the current table and 404 for a missing file stay as P16 has them.
//
// S1.3 is a generated walk. Each step reads the walk's state (the table the brain carries now, the
// tables it carried before) and builds a move that state allows: a rebuild, or a request for a route
// the current table holds, a fresh absent route or `/`, with the current validator or a stale one.
import { createHash } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BrainOptions, Env } from "./runtime.ts";

type Asset = { readonly hash: string; readonly type: string; readonly body: string };
type Assets = Readonly<Record<string, Asset>>;
type Fetch = (request: Request, env: Env, config: BrainOptions, assets?: Assets) => Effect.Effect<Response, unknown>;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const CSS = "text/css; charset=utf-8";
const PAGE = "/index.html";

const fetchApi = async (): Promise<Fetch> => ((await import("./fetch.ts")) as { fetch: Fetch }).fetch;

const config = (port: number): BrainOptions => ({
  name: "p14",
  port,
  person: "person-test",
  founder: "public-test",
  window: null,
  build: "test",
  rateLimit: { limit: 100_000, window: 60_000 },
});

/** An environment whose every stub call is written down, so the law can say none was made. */
const world = () => {
  const calls: Array<string> = [];
  const stub = (to: string) =>
    new Proxy(
      {},
      {
        get:
          (_t, method) =>
          (..._args: Array<unknown>) => {
            calls.push(`${to}.${String(method)}`);
            return Promise.resolve({ _tag: "ok" });
          },
      },
    );
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only the RPC members these routes call
  const env = {
    PROJECT: { getByName: () => stub("project") },
    CONNECTION: { getByName: () => stub("connection") },
    PROCESS: { getByName: () => stub("process") },
    RECORD: { getByName: () => stub("record") },
  } as unknown as Env;
  return { env, calls };
};

const must = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw new Error(Cause.pretty(exit.cause));
};

/** One generated step: choice seeds and values the walk turns into a move against its state. */
const step = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  method: fc.nat(),
  host: fc.nat(),
  origin: fc.nat(),
  validator: fc.nat(),
  text: fc.string({ unit: "grapheme", maxLength: 40 }),
  word: fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,8}$/),
  extra: fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { maxLength: 3 }),
});

type Step = typeof step extends fc.Arbitrary<infer S> ? S : never;
const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE"] as const;

/** A rebuild's table, derived from the step: a page or none, the tab's script, and other files. */
const rebuilt = (s: Step, generation: number): Assets => {
  const assets: Record<string, Asset> = {};
  const add = (route: string, type: string, body: string) => {
    assets[route] = { hash: sha(body), type, body };
  };

  if (s.pick % 3 !== 0) {
    add(PAGE, HTML, `<!doctype html>${s.text}<!-- ${generation} -->`);
  }

  add("/window.js", JS, `export const g = ${generation}; ${JSON.stringify(s.text)};`);

  for (const [n, name] of s.extra.entries()) {
    add(`/${name}-${n}.${n % 2 === 0 ? "js" : "css"}`, n % 2 === 0 ? JS : CSS, `/* ${generation} ${name} */`);
  }

  return assets;
};

/** What reached means for this walk: each a case a run must have exercised to claim coverage. */
const REACH = ["page", "plain-root", "asset", "absent", "head", "write", "stale", "current", "host", "origin"] as const;

describe("P14 S1.3: the brain serves the built page at / and keeps P16's serving rules", () => {
  it("generated walks of rebuilds and requests: GET, HEAD, ETag, missing routes, root fallback and access checks", async () => {
    const fetch = await fetchApi();
    const reached = new Set<(typeof REACH)[number]>();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 65_535 }),
        fc.array(step, { minLength: 1, maxLength: 24 }),
        async (port, steps) => {
          const { env, calls } = world();
          const origin = `http://127.0.0.1:${port}`;
          // The walk's state: the table the brain carries now (none before the first build), and every
          // validator an earlier table served.
          let current: Assets | undefined;
          const stale: Array<string> = [];
          let generation = 0;

          for (const s of steps) {
            // A rebuild is always possible; the first move of a walk with no table yet may also be one.
            if (s.move % 4 === 0) {
              for (const asset of Object.values(current ?? {})) {
                stale.push(asset.hash);
              }

              current = rebuilt(s, ++generation);
              continue;
            }

            const routes = Object.keys(current ?? {});
            const choices = ["/", ...routes, `/${s.word}-absent.js`];
            const path = choices[s.pick % choices.length]!;
            const method = METHODS[s.method % METHODS.length]!;
            const wrongHost = s.host % 5 === 0;
            const originHeader = s.origin % 5 === 0 ? "http://evil.example" : s.origin % 5 === 1 ? origin : null;
            const target = path === "/" ? (current !== undefined && Object.hasOwn(current, PAGE) ? PAGE : null) : path;
            const asset =
              target !== null && current !== undefined && Object.hasOwn(current, target) ? current[target] : undefined;
            const validators = [
              ...(asset === undefined ? [] : [`"${asset.hash}"`]),
              ...stale.filter((h) => h !== asset?.hash).map((h) => `"${h}"`),
            ];
            const validator =
              validators.length > 0 && s.validator % 3 !== 0 ? validators[s.validator % validators.length]! : null;
            const headers: Record<string, string> = { host: wrongHost ? "evil.example" : `127.0.0.1:${port}` };

            if (originHeader !== null) {
              headers.origin = originHeader;
            }

            if (validator !== null) {
              headers["if-none-match"] = validator;
            }

            const response = must(
              await Effect.runPromiseExit(
                fetch(
                  new Request(`${origin}${path}`, {
                    method,
                    headers,
                    ...(method === "GET" || method === "HEAD" ? {} : { body: s.text }),
                  }),
                  env,
                  config(port),
                  current,
                ),
              ),
            );
            const body = await response.text();

            if (wrongHost) {
              reached.add("host");
              expect(response.status, "a wrong host is refused before any route").toBe(421);
              continue;
            }

            if (originHeader === "http://evil.example") {
              reached.add("origin");
              expect(response.status, "a foreign origin is refused before any route").toBe(403);
              continue;
            }

            const reads = method === "GET" || method === "HEAD";

            if (method === "HEAD") {
              reached.add("head");
            }

            if (!reads) {
              reached.add("write");
            }

            if (reads && asset !== undefined) {
              reached.add(path === "/" ? "page" : "asset");
              expect(response.headers.get("content-type"), `${method} ${path}`).toBe(asset.type);
              expect(response.headers.get("etag"), `${method} ${path} carries the current table's validator`).toBe(
                `"${asset.hash}"`,
              );

              if (validator === `"${asset.hash}"`) {
                reached.add("current");
                // The current validator may be answered as unchanged, never with another body.
                expect([200, 304]).toContain(response.status);
                expect(body).toBe(response.status === 304 || method === "HEAD" ? "" : asset.body);
              } else {
                if (validator !== null) {
                  reached.add("stale");
                }

                expect(response.status, `${method} ${path}`).toBe(200);
                expect(body, `${method} ${path}: HEAD has no body, GET the current one`).toBe(
                  method === "HEAD" ? "" : asset.body,
                );
              }
            } else if (path === "/" || !reads || current === undefined) {
              if (path === "/") {
                reached.add("plain-root");
              }

              // No page, a write, or a brain with no table: the plain answer, as P12 and P16 have it.
              expect(response.status, `${method} ${path}`).toBe(200);
              expect(response.headers.get("content-type"), `${method} ${path}`).toContain("text/plain");
            } else {
              reached.add("absent");
              expect(response.status, `${method} ${path} is not in the table`).toBe(404);
            }
          }

          expect(calls, "serving files reaches no object").toEqual([]);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
    expect([...reached].sort(), "every serving case was reached by the generated walks").toEqual([...REACH].sort());
  });
});
