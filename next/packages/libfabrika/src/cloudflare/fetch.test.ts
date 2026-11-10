// P12, next/. The public Worker route is plain libfabrika code. No socket or workerd class.
// Builder contract: workers/fetch.ts exports fetch(request, env, config), returning an Effect.
import { Cause, Effect, Exit } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BrainOptions, Env } from "./runtime.ts";

type Fetch = (request: Request, env: Env, config: BrainOptions) => Effect.Effect<Response, unknown>;
const moduleURL = new URL("./fetch.ts", import.meta.url).href;

const load = async (): Promise<Fetch> => {
  const module: { fetch?: Fetch } = await import(/* @vite-ignore */ moduleURL).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return {};
    }

    throw error;
  });
  expect(module.fetch, "P12 requires the public fetch function in libfabrika/workers/fetch.ts").toBeTypeOf("function");

  if (module.fetch === undefined) {
    throw new Error("Missing public fetch function");
  }

  return module.fetch;
};

const generated = fc.record({
  port: fc.integer({ min: 1024, max: 65535 }),
  name: fc.uuid(),
  id: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ?#/%+]{0,20}$/),
  code: fc.string({ maxLength: 40 }),
  body: fc.jsonValue(),
});

const law = (
  name: string,
  check: (input: ReturnType<typeof generated.generate>["value"], fetch: Fetch) => Promise<void>,
) =>
  it(name, async () => {
    const fetch = await load();
    await fc.assert(
      fc.asyncProperty(generated, (input) => check(input, fetch)),
      { seed: 119120, numRuns: 20 },
    );
  });

const world = (port: number, name: string) => {
  const calls: Array<{ to: string; method: string; args: unknown[] }> = [];
  const response = new Response("gateway", { status: 202 });
  const config: BrainOptions = {
    name,
    port,
    person: "person-test",
    founder: "public-test",
    window: null,
    build: "build-test",
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only the RPC members the public routes call
  const env = {
    GATEWAY: {
      getByName: (to: string) => ({
        fetch: async (request: Request) => {
          calls.push({ to, method: "fetch", args: [request] });
          return response;
        },
      }),
    },
    PROJECT: {
      getByName: (to: string) => ({
        grant: async (body: unknown) => {
          calls.push({ to, method: "grant", args: [body] });
          return { granted: body };
        },
        target: async (target: string, code: string) => {
          calls.push({ to, method: "target", args: [target, code] });
          return { target, code };
        },
      }),
    },
  } as unknown as Env;
  const origin = `http://127.0.0.1:${port}`;
  const request = (
    path: string,
    method = "GET",
    originHeader: string | null = origin,
    host = `127.0.0.1:${port}`,
    body?: unknown,
  ) =>
    new Request(`${origin}${path}`, {
      method,
      headers: { host, ...(originHeader === null ? {} : { origin: originHeader }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { calls, response, env, config, origin, request };
};

describe("P12 public Worker fetch", () => {
  it("malformed grant target escapes fail typed before any Project call", async () => {
    const fetch = await load();
    const bad = fc
      .tuple(fc.string(), fc.constantFrom("%", "%G0", "%0G", "%C0%AF", "%E0%A4", "%ED%A0%80", "%F4%90%80%80"))
      .map(([prefix, suffix]) => encodeURIComponent(prefix) + suffix);
    await fc.assert(
      fc.asyncProperty(bad, async (target) => {
        const w = world(18787, "parse-test");
        const exit = await Effect.runPromiseExit(fetch(w.request(`/grant/client/${target}`), w.env, w.config));
        expect(Exit.isFailure(exit)).toBe(true);
        const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
        expect(Cause.hasDies(cause)).toBe(false);
        expect(Cause.hasFails(cause)).toBe(true);
        expect(w.calls).toEqual([]);
      }),
      { seed: 119120, numRuns: 30, examples: [["%"]] },
    );
  });
  it("malformed JSON grant bodies fail typed before any Project call", async () => {
    const fetch = await load();
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue().map((v) => `${JSON.stringify(v)}!`),
        async (body) => {
          const w = world(18787, "parse-test");
          const request = new Request(`${w.origin}/grant`, {
            method: "POST",
            headers: { host: "127.0.0.1:18787" },
            body,
          });
          const exit = await Effect.runPromiseExit(fetch(request, w.env, w.config));
          expect(Exit.isFailure(exit)).toBe(true);
          const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
          expect(Cause.hasDies(cause)).toBe(false);
          expect(Cause.hasFails(cause)).toBe(true);
          expect(w.calls).toEqual([]);
        },
      ),
      { seed: 119120, numRuns: 20, examples: [["{"]] },
    );
  });
  law("wrong hosts refuse every route before RPC or body work", async ({ port, name, body }, fetch) => {
    const w = world(port, name);

    for (const host of [
      `localhost:${port}`,
      `127.0.0.1:${port === 65535 ? port - 1 : port + 1}`,
      "other.invalid",
      `127.0.0.1:${port}.`,
    ]) {
      for (const path of ["/client/a", "/grant", "/grant/client/a", "/"]) {
        const result = await Effect.runPromise(fetch(w.request(path, "POST", w.origin, host, body), w.env, w.config));
        expect(result.status).toBe(421);
      }
    }

    expect(w.calls).toEqual([]);
  });
  law("foreign origins refuse every route before RPC", async ({ port, name, body }, fetch) => {
    const w = world(port, name);

    for (const origin of [`https://127.0.0.1:${port}`, `http://localhost:${port}`, "null", "https://other.invalid"]) {
      for (const path of ["/client/a", "/grant", "/grant/client/a", "/"]) {
        const result = await Effect.runPromise(
          fetch(w.request(path, "POST", origin, undefined, body), w.env, w.config),
        );
        expect(result.status).toBe(403);
      }
    }

    expect(w.calls).toEqual([]);
  });
  law("a matching or absent origin forwards the exact client request and path", async ({ port, name, id }, fetch) => {
    for (const originHeader of [null, `http://127.0.0.1:${port}`]) {
      const w = world(port, name),
        path = `/client/${encodeURIComponent(id)}`;
      const request = w.request(path, "GET", originHeader);
      const answer = await Effect.runPromise(fetch(request, w.env, w.config));
      expect(answer).toBe(w.response);
      expect(w.calls).toEqual([{ to: path, method: "fetch", args: [request] }]);
    }
  });
  law("POST grant forwards parsed JSON only to the configured project", async ({ port, name, body }, fetch) => {
    const w = world(port, name);
    const result = await Effect.runPromise(
      fetch(w.request("/grant", "POST", w.origin, undefined, body), w.env, w.config),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ granted: body });
    expect(w.calls).toEqual([{ to: name, method: "grant", args: [body] }]);
  });
  law(
    "GET grant client decodes its name and code, with empty code as the default",
    async ({ port, name, id, code }, fetch) => {
      for (const query of ["", `?code=${encodeURIComponent(code)}`]) {
        const w = world(port, name);
        const result = await Effect.runPromise(
          fetch(w.request(`/grant/client/${encodeURIComponent(id)}${query}`), w.env, w.config),
        );
        const expected = query === "" ? "" : code;
        expect(await result.json()).toEqual({ target: id, code: expected });
        expect(w.calls).toEqual([{ to: name, method: "target", args: [id, expected] }]);
      }
    },
  );
  law("unmatched routes and grant methods return the text response without RPC", async ({ port, name }, fetch) => {
    const w = world(port, name);

    for (const [path, method] of [
      ["/", "GET"],
      ["/other", "POST"],
      ["/grant", "GET"],
      ["/grant/client/a", "POST"],
      ["/client", "GET"],
    ] as const) {
      const result = await Effect.runPromise(fetch(w.request(path, method), w.env, w.config));
      expect(result.status).toBe(200);
      expect(result.headers.get("content-type")).toContain("text/plain");
      expect(await result.text()).toBe("fabrika");
    }

    expect(w.calls).toEqual([]);
  });
});
