// P14, next/ (Tier 1, ticket 286): what the Worker adds for the first window. Written before the
// changes (the plan's "The wire against P12 as built", "Scope and ownership", and A10). Each module
// loads by `import()` inside its test, so a missing name is a red test.
//
// The shape these laws hold the code to, from the plan's words (the build may add more):
// - A10: the window rides in P16's tables. `fetch(request, env, config, assets)` takes P16's table of
//   window files by route, each `{hash, type, body}`. The page is the asset at `/index.html`, typed
//   `text/html; charset=utf-8`: `GET` or `HEAD /` answers it with its type and its ETag when the
//   table holds it, and the plain `fabrika` as today when it does not. `/window.js` is served as any
//   other asset. The Host and Origin checks come first for every path. No other route changes.
// - `control` has `settings` among its fixed project methods: with the bearer it reaches the Project's
//   `settings` call once, with the caller's arguments; without it, never. Public `fetch` has no route
//   to it.
// - `viewNotice(pid, update)` (exported by `runtime.ts`): `view.whole` or `view.patch` with the update
//   as its params and `pid` added to both shapes; the update is not changed.
// - `bootstraps(option)` (exported by `runtime.ts`): the bootstraps a Project starts. A single
//   `{name, id, program}` stays valid and is one; an array keeps its order; a repeated name or id is
//   refused.
import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Redacted } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BrainOptions, Env } from "./runtime.ts";

const SEED = 119120;
const opts = { seed: SEED, numRuns: 40 };

/** P16's window table: each route's `{hash, type, body}` (`app/built.ts`'s Asset). */
type Asset = { readonly hash: string; readonly type: string; readonly body: string };
type Assets = Readonly<Record<string, Asset>>;

type Fetch = (request: Request, env: Env, config: BrainOptions, assets?: Assets) => Effect.Effect<Response, unknown>;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";

/** A built table: the page at `/index.html` when `page` is given, the tab's script at `/window.js`. */
const table = (page: string | null, script: string): Assets => ({
  ...(page === null ? {} : { "/index.html": { hash: sha(page), type: HTML, body: page } }),
  "/window.js": { hash: sha(script), type: JS, body: script },
});

type Control = (
  request: Request,
  env: Env,
  token: Redacted.Redacted<string>,
  programs: object,
) => Effect.Effect<Response, unknown>;

type Bootstrap = { readonly name: string; readonly id: string; readonly program: string };

interface Runtime {
  readonly viewNotice: (
    pid: string,
    update: unknown,
  ) => { readonly method: string; readonly params: Record<string, unknown> };
  readonly bootstraps: (option: Bootstrap | ReadonlyArray<Bootstrap>) => ReadonlyArray<Bootstrap>;
}

const fetchApi = async (): Promise<Fetch> => ((await import("./fetch.ts")) as { fetch: Fetch }).fetch;

const controlApi = async (): Promise<Control> => ((await import("./control.ts")) as { control: Control }).control;

const runtimeApi = async (): Promise<Runtime> => {
  // oxlint-disable-next-line fabrika/no-type-assertions -- the module is loaded by import() so a missing one is a red test; the cast names the shape the plan gives it
  const loaded = (await import("./runtime.ts")) as unknown as Partial<Runtime>;
  expect(loaded.viewNotice, "runtime.ts exports viewNotice").toBeTypeOf("function");
  expect(loaded.bootstraps, "runtime.ts exports bootstraps").toBeTypeOf("function");
  return loaded as Runtime;
};

const word = fc.stringMatching(/^[A-Za-z0-9]{4,16}$/);

const config = (port: number): BrainOptions => ({
  name: "p14",
  port,
  person: "person-test",
  founder: "public-test",
  window: null,
  build: "test",
});

/** An environment whose every stub call is written down, so a law can say none was made. */
const world = () => {
  const calls: Array<{
    readonly to: string;
    readonly method: string;
    readonly args: ReadonlyArray<unknown>;
  }> = [];
  const stub = (to: string) =>
    new Proxy(
      {},
      {
        get:
          (_t, method) =>
          (...args: Array<unknown>) => {
            calls.push({ to, method: String(method), args });
            return Promise.resolve({ _tag: "ok" });
          },
      },
    );
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only the RPC members these routes call
  const env = {
    PROJECT: { getByName: () => stub("project") },
    GATEWAY: { getByName: () => stub("gateway") },
    PROCESS: { getByName: () => stub("process") },
    RECORD: { getByName: () => stub("record") },
  } as unknown as Env;
  return { env, calls };
};

const run = <A, E>(work: Effect.Effect<A, E>) => Effect.runPromiseExit(work);

const must = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw new Error(Cause.pretty(exit.cause));
};

describe("P14: the Worker serves the built page and script, behind the same checks", () => {
  it("GET or HEAD / answers the built page as text/html with its ETag, /window.js the script; Host and Origin are checked first for both", async () => {
    const fetch = await fetchApi();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 65_535 }),
        fc.string({ unit: "grapheme", maxLength: 40 }),
        word,
        async (port, page, script) => {
          const { env, calls } = world();
          const origin = `http://127.0.0.1:${port}`;
          const assets = table(page, script);
          const at = (path: string, headers: Record<string, string> = {}, method = "GET") =>
            run(
              fetch(
                new Request(`${origin}${path}`, { method, headers: { host: `127.0.0.1:${port}`, ...headers } }),
                env,
                config(port),
                assets,
              ),
            );

          for (const method of ["GET", "HEAD"]) {
            const home = must(await at("/", {}, method));
            expect(home.status, `${method} /`).toBe(200);
            expect(home.headers.get("content-type"), `${method} /`).toBe(HTML);
            expect(home.headers.get("etag"), `${method} / carries the page's ETag`).toBe(`"${sha(page)}"`);
            expect(await home.text(), `${method} /`).toBe(method === "HEAD" ? "" : page);
          }

          const code = must(await at("/window.js"));
          expect(code.status).toBe(200);
          expect(code.headers.get("content-type")).toBe(JS);
          expect(code.headers.get("etag")).toBe(`"${sha(script)}"`);
          expect(await code.text()).toBe(script);

          for (const path of ["/", "/window.js"]) {
            expect(must(await at(path, { host: "evil.example" })).status).toBe(421);
            expect(must(await at(path, { origin: "http://evil.example" })).status).toBe(403);
          }

          expect(calls, "serving the page reaches no object").toEqual([]);
        },
      ),
      opts,
    );
  });
  it("with no page built, / is the plain answer as today, and the table's other files are still served", async () => {
    const fetch = await fetchApi();
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1024, max: 65_535 }), word, fc.boolean(), async (port, script, empty) => {
        const { env, calls } = world();
        const assets = empty ? undefined : table(null, script);

        for (const method of ["GET", "HEAD"]) {
          const home = must(
            await run(
              fetch(
                new Request(`http://127.0.0.1:${port}/`, { method, headers: { host: `127.0.0.1:${port}` } }),
                env,
                config(port),
                assets,
              ),
            ),
          );
          expect(home.status).toBe(200);
          expect(home.headers.get("content-type")).toContain("text/plain");

          if (method === "GET") {
            expect(await home.text()).toBe("fabrika");
          }
        }

        expect(calls).toEqual([]);
      }),
      opts,
    );
  });
  it("other routes are as P12 has them: the plain answer, and no route to a settings call", async () => {
    const fetch = await fetchApi();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 65_535 }),
        fc.constantFrom("/settings", "/control", "/window.js/x", "/person/x/settings", "/api/settings", "//window.js"),
        fc.constantFrom("GET", "POST", "PUT"),
        fc.jsonValue(),
        async (port, path, method, body) => {
          const { env, calls } = world();
          const request = new Request(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { host: `127.0.0.1:${port}` },
            ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
          });
          const out = must(await run(fetch(request, env, config(port), table("PAGE", "SCRIPT"))));
          // P16: an unknown window path read by GET is 404; any other method keeps the plain answer.
          expect(out.status).toBe(method === "GET" ? 404 : 200);

          if (method !== "GET") {
            expect(await out.text()).toBe("fabrika");
          }

          expect(calls.filter((c) => c.method === "settings")).toEqual([]);
        },
      ),
      opts,
    );
  });
});

describe("P14: settings are written only through the trusted control call", () => {
  const body = (args: ReadonlyArray<unknown>) =>
    JSON.stringify({ target: "project", project: "p14", name: "p14", method: "settings", args });
  it("with the bearer, the Project's settings call is made once with the caller's arguments", async () => {
    const control = await controlApi();
    await fc.assert(
      fc.asyncProperty(word, fc.array(fc.jsonValue(), { maxLength: 3 }), async (token, args) => {
        const { env, calls } = world();
        const out = must(
          await run(
            control(
              new Request("http://local/", {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
                body: body(args),
              }),
              env,
              Redacted.make(token),
              {},
            ),
          ),
        );
        expect(out.status).toBe(200);
        expect(calls).toEqual([{ to: "project", method: "settings", args }]);
      }),
      opts,
    );
  });
  it("without the bearer, or with another, it is refused and nothing is called", async () => {
    const control = await controlApi();
    await fc.assert(
      fc.asyncProperty(
        word,
        word,
        fc.array(fc.jsonValue(), { maxLength: 3 }),
        fc.constantFrom("none", "wrong", "scheme"),
        async (token, other, args, kind) => {
          fc.pre(token !== other);
          const { env, calls } = world();
          const headers: Record<string, string> =
            kind === "none"
              ? {}
              : kind === "wrong"
                ? { authorization: `Bearer ${other}` }
                : { authorization: `Basic ${token}` };
          const out = must(
            await run(
              control(
                new Request("http://local/", { method: "POST", headers, body: body(args) }),
                env,
                Redacted.make(token),
                {},
              ),
            ),
          );
          expect(out.status).toBe(403);
          expect(calls).toEqual([]);
        },
      ),
      opts,
    );
  });
});

describe("P14: a view notification names its process", () => {
  const view = fc.jsonValue();
  it("both shapes carry the pid and keep every other field", async () => {
    const { viewNotice } = await runtimeApi();
    await fc.assert(
      fc.property(
        word,
        fc.nat(1000),
        fc.nat(1000),
        view,
        fc.array(
          fc.record({
            op: fc.constantFrom("add", "remove", "replace"),
            path: fc.constantFrom("/a", "/b/0"),
            value: fc.jsonValue(),
          }),
          { maxLength: 3 },
        ),
        (pid, base, rev, v, patch) => {
          const whole = { type: "whole", rev, view: v };
          const step = { type: "patch", base, rev, patch };
          const frozen = structuredClone([whole, step]);
          const a = viewNotice(`process_${pid}`, whole);
          const b = viewNotice(`process_${pid}`, step);
          expect(a).toEqual({ method: "view.whole", params: { pid: `process_${pid}`, ...whole } });
          expect(b).toEqual({ method: "view.patch", params: { pid: `process_${pid}`, ...step } });
          expect([whole, step]).toEqual(frozen);
        },
      ),
      opts,
    );
  });
});

describe("P14: a Project starts every bootstrap it is given, once", () => {
  const one = fc.record({ name: word, id: word, program: word });
  it("a single bootstrap stays valid and is one; an array keeps its order", async () => {
    const { bootstraps } = await runtimeApi();
    fc.assert(
      fc.property(
        fc.uniqueArray(one, {
          minLength: 1,
          maxLength: 4,
          comparator: (x, y) => x.name === y.name || x.id === y.id,
        }),
        (list) => {
          expect(bootstraps(list[0] as Bootstrap)).toEqual([list[0]]);
          expect(bootstraps(list)).toEqual(list);
        },
      ),
      opts,
    );
  });
  it("a repeated name or id is refused", async () => {
    const { bootstraps } = await runtimeApi();
    fc.assert(
      fc.property(one, one, fc.constantFrom("name", "id"), (a, b, which) => {
        const second = which === "name" ? { ...b, name: a.name } : { ...b, id: a.id };
        expect(() => bootstraps([a, second])).toThrow();
      }),
      opts,
    );
  });
});
