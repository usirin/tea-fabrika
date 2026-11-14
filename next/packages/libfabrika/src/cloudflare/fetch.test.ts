import { createHash } from "node:crypto";
// P12, next/. The public Worker route is plain libfabrika code. No socket or workerd class.
// Builder contract: workers/fetch.ts exports fetch(request, env, config), returning an Effect.
import { Cause, Effect, Exit } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import * as StartsTest from "../settings/StartsTest.ts";
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

// `settingsStart` answers the Project's good reply by default; a law may hold each answer back.
const world = (
  port: number,
  name: string,
  settingsStart: (reply: unknown) => Promise<unknown> = async (reply) => reply,
) => {
  const calls: Array<{ to: string; method: string; args: unknown[] }> = [];
  const response = new Response("gateway", { status: 202 });
  const config = instanceFixture({
    name,
    port,
    person: "person-test",
    founder: "public-test",
    window: null,
    build: "build-test",
  });
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node doubles implement only the RPC members the public routes call
  const env = {
    INSTANCE: JSON.stringify(config),
    CONNECTION: {
      getByName: (to: string) => ({
        fetch: async (request: Request) => {
          calls.push({ to, method: "fetch", args: [request] });
          return response;
        },
      }),
    },
    PROJECT: {
      getByName: (to: string) => ({
        settingsStart: () => settingsStart(StartsTest.reply(config)),
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
      // T502 S1: the request crosses through Alchemy's typed stub, whose fetcher sends the object a
      // copy of it with every part kept, and gives the object's answer back as a Response of its own.
      expect(answer.status).toBe(w.response.status);
      expect(await answer.text()).toBe("gateway");
      expect(w.calls.map(({ to, method }) => ({ to, method }))).toEqual([{ to: path, method: "fetch" }]);
      const sent: unknown = w.calls[0]?.args[0];
      expect(sent).toBeInstanceOf(Request);
      expect(sent instanceof Request ? [sent.method, sent.url, [...sent.headers]] : []).toEqual([
        request.method,
        request.url,
        [...request.headers],
      ]);
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
  // The platform gives each request to a Worker its own I/O context and cancels as hung a request
  // that waits on work another request started. So a request never waits on another's read.
  it("requests that arrive before any read of the recorded start has finished each read for themselves, and a finished read serves the later ones", async () => {
    const fetch = await load();
    const arrivals = fc.integer({ min: 2, max: 8 }).chain((n) =>
      fc.shuffledSubarray(
        Array.from({ length: n }, (_, at) => at),
        { minLength: n },
      ),
    );
    await fc.assert(
      fc.asyncProperty(arrivals, generated, async (order, { port, name }) => {
        const held: Array<() => void> = [];
        const w = world(port, name, (reply) => new Promise((answer) => held.push(() => answer(reply))));
        const answered: Array<number> = [];
        const first = order.map(() =>
          Effect.runPromise(fetch(w.request("/"), w.env, w.config)).then((response) => {
            answered.push(response.status);
            return response;
          }),
        );
        // With no read finished, every request has asked the Project for itself.
        await vi.waitFor(() => expect(held).toHaveLength(order.length));

        // The reads finish in any order. A held read is not tied to the request that started it,
        // since requests reach their read in any order, so the law counts: each finished read
        // answers exactly one more request, and none waits on a read another request started.
        for (const [done, at] of order.entries()) {
          held[at]?.();
          await vi.waitFor(() => expect(answered).toHaveLength(done + 1));
          await new Promise((settle) => setTimeout(settle, 0));
          expect(answered).toHaveLength(done + 1);
        }

        expect(answered).toEqual(order.map(() => 200));
        await Promise.all(first);

        // A read has finished, so a later request asks nothing.
        expect((await Effect.runPromise(fetch(w.request("/"), w.env, w.config))).status).toBe(200);
        expect(held).toHaveLength(order.length);
      }),
      { seed: 119120, numRuns: 20 },
    );
  });
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

function instanceFixture(config: StartsTest.Fixture) {
  return StartsTest.fixture(config, (algorithm, data) =>
    createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
  );
}
