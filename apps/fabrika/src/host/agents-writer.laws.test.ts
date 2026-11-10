import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { keyFileText, keyLineOf, Ledger } from "@kampus/fabrika-old";
import { startTwin } from "@kampus/ledger-server/twin";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import { Context, Effect, Exit, Layer, Logger, Path, Schedule, Scope } from "effect";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, hostLedger } from "./connection.ts";
import { runHost } from "./run.ts";
import { pathsOf, reach } from "./socket.ts";

// The law the ledger note asked for (tracker 185): no write from the agents' socket is the
// person's. On a home connected to the ledger server's twin, two agents, `claude` and `lead`, each
// on the bridge Claude Code would start, make any sequence of tracker writes. Every row any of
// them wrote is stamped `agent:<its name> for:github:7` by the door: never alice's own writer, and
// never the other agent's. Today's version. A line in the agent's own tile joins it in 185b, PR 3
// (d13): its tsh runs on that agent's session, so its rows are the agent's too, and so is its job.
//
//   claude   tracker_file    {value: {title: "m-3", body: ""}}      row: agent:claude for:github:7
//   lead     tracker_comment {value: {ticket: 1, body: "m-4"}}      row: agent:lead for:github:7
//   claude   line {line: `tracker file='{"title":"m-5","body":""}' &`}
//                                                                   row: agent:claude for:github:7
//                                                                   job_began by=agent:claude for:github:7
//
// The server is its twin in Miniflare (packages/ledger-server); GitHub is a fake that lists
// alice's key, made here at test time. No call leaves the laptop.

const users = new Map<string, { id: number; keys: string[] }>();

const fakeGitHub = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.host !== "api.github.com") {
    return new Response("not here", { status: 502 });
  }

  const byId = /^\/user\/([0-9]+)$/.exec(url.pathname);

  if (byId !== null) {
    const found = [...users].find(([, u]) => u.id === Number(byId[1]));
    return found === undefined
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json({ id: found[1].id, login: found[0] });
  }

  const m = /^\/users\/([^/]+)(\/keys)?$/.exec(url.pathname);
  const u = m?.[1] === undefined ? undefined : users.get(decodeURIComponent(m[1]));

  if (u === undefined) {
    return Response.json({ message: "Not Found" }, { status: 404 });
  }

  return m?.[2] === undefined
    ? Response.json({ id: u.id, login: m?.[1] })
    : Response.json(u.keys.map((key, i) => ({ id: i + 1, key })));
};

const platform = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

let root = "";
let address = "";
const twinScope = Effect.runSync(Scope.make());

beforeAll(async () => {
  // Short, so the host's socket path stays under its 103 bytes.
  root = mkdtempSync(join(tmpdir(), "aw-"));
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  writeFileSync(join(root, "key"), await keyFileText(pair, "alice@laptop"), { mode: 0o600 });
  const line = keyLineOf(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  users.set("alice", { id: 7, keys: [line] });
  const twin = await Effect.runPromise(
    startTwin({
      config: { name: "acme-ledger", founder: "github:7" },
      persist: false,
      github: fakeGitHub,
      cacheMs: 0,
    }).pipe(Scope.provide(twinScope)),
  );
  address = `${twin.url}/acme`;
});

afterAll(async () => {
  await Effect.runPromise(Scope.close(twinScope, Exit.void));
  rmSync(root, { recursive: true, force: true });
});

const NAMES = ["claude", "lead"] as const;
type Name = (typeof NAMES)[number];

/** An MCP client on `node cli.ts mcp --as <name>`, and one tool call that answers its text. */
const agentOn = (home: string, name: Name) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const cli = yield* path.fromFileUrl(new URL("../cli.ts", import.meta.url)).pipe(Effect.orDie);
    const client = new Client({ name: "test", version: "0.0.0" });
    yield* Effect.acquireRelease(
      Effect.promise(() =>
        client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [cli, "mcp", "--as", name],
            env: { ...getDefaultEnvironment(), FABRIKA_HOME: home },
            stderr: "pipe",
          }),
        ),
      ),
      () => Effect.promise(() => client.close()).pipe(Effect.ignore),
    );
    return async (tool: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: tool, arguments: args });
      const first = Array.isArray(result.content) ? result.content[0] : undefined;
      return { error: result.isError === true, text: String(Reflect.get(Object(first), "text")) };
    };
  });

/**
 * One write an agent asks for: a ticket, a comment on ticket 1, or a ticket filed by a line in the
 * agent's own tile. Its mark is its title or body.
 */
const write = fc.record({
  who: fc.constantFrom<Name>(...NAMES),
  what: fc.constantFrom("file", "comment", "line"),
});

/** The tool call that asks for `what`, with `mark` in it. */
const callFor = (
  what: "file" | "comment" | "line",
  mark: string,
): readonly [tool: string, args: Record<string, unknown>] => {
  if (what === "file") {
    return ["tracker_file", { value: { title: mark, body: "" } }];
  }

  if (what === "comment") {
    return ["tracker_comment", { value: { ticket: 1, body: mark } }];
  }

  return ["line", { line: `tracker file='{"title":"${mark}","body":""}' &` }];
};

/** The writer of each job the host began, from its log, as `Logger.formatSimple` writes it. */
const jobWriters = (lines: readonly string[]) =>
  lines
    .filter((l) => l.includes("message=job_began"))
    .map((l) => /\bby="([^"]*)"|\bby=(\S+)/.exec(l))
    .map((m) => m?.[1] ?? m?.[2] ?? "");

describe("law: no write from the agents' socket is the person's", () => {
  it("any sequence of tracker writes by two agents lands as each agent's own, for alice", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const home = join(root, "h");
        mkdirSync(home, { recursive: true });
        yield* connect(home, { address, login: "alice", key: join(root, "key") });
        const paths = yield* pathsOf(home);
        const host = yield* Scope.make();
        const lines: string[] = [];
        const caught = Logger.make((o) => {
          lines.push(Logger.formatSimple.log(o));
        });
        yield* runHost({ home, pid: process.pid }).pipe(
          Effect.scoped,
          Effect.provide(Logger.layer([caught])),
          Effect.forkIn(host),
        );
        yield* Effect.addFinalizer(() => Scope.close(host, Exit.void));
        yield* reach(paths.mcp).pipe(
          Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("10 millis") }),
          Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.die("no host") }),
        );
        const calls = { claude: yield* agentOn(home, "claude"), lead: yield* agentOn(home, "lead") };
        const services = yield* Layer.build(hostLedger(home));
        const person = Context.get(services, Ledger);
        /** Every row now, read through alice's own session. */
        const rows = () => Effect.runPromise(person.read(0, 10_000));
        /** The rows holding each mark, once every mark is on the ledger; null after 10 s. */
        const landed = async (marks: readonly string[]) => {
          for (let i = 0; i < 400; i += 1) {
            const all = await rows();
            const found = marks.map((m) => all.filter((r) => r.data.includes(m)));

            if (found.every((f) => f.length > 0)) {
              return found;
            }

            await new Promise((done) => setTimeout(done, 25));
          }

          return null;
        };

        // Ticket 1, for the comments to go on.
        const base = yield* Effect.promise(() =>
          calls.claude("tracker_file", { value: { title: "base-ticket", body: "" } }),
        );
        const failures: string[] = [];

        if (base.error) {
          failures.push(`claude could not file ticket 1: ${base.text}`);
        } else if ((yield* Effect.promise(() => landed(["base-ticket"]))) === null) {
          failures.push("ticket 1 never landed");
        }

        let count = 0;

        if (failures.length === 0) {
          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(fc.array(write, { minLength: 1, maxLength: 4 }), async (writes) => {
                const asked = writes.map((w) => {
                  count += 1;
                  return { ...w, mark: `mark-${count}-${w.who}` };
                });

                for (const w of asked) {
                  const answer = await calls[w.who](...callFor(w.what, w.mark));

                  if (answer.error) {
                    failures.push(`${w.who} ${w.what} was refused: ${answer.text}`);
                    return false;
                  }
                }

                const found = await landed(asked.map((w) => w.mark));

                if (found === null) {
                  failures.push(`not every write landed: ${asked.map((w) => w.mark).join(", ")}`);
                  return false;
                }

                asked.forEach((w, i) => {
                  for (const row of found[i] ?? []) {
                    if (row.writer !== `agent:${w.who} for:github:7`) {
                      failures.push(`${w.mark} was written as ${row.writer}`);
                    }
                  }
                });
                return failures.length === 0;
              }),
              { numRuns: 8, seed: 119120, endOnFailure: true },
            ),
          ).pipe(Effect.ignore);
        }

        // Across every run: no row that holds an agent's mark is alice's own, or nobody's.
        const all = yield* Effect.promise(rows);
        const marked = all.filter((r) => r.data.includes("mark-") || r.data.includes("base-ticket"));
        const writers = [...new Set(marked.map((r) => r.writer))].sort();
        // A line in an agent's tile is a job, and the job is the agent's as its rows are.
        return { failures, writers, count, jobs: jobWriters(lines) };
      }).pipe(Effect.scoped, Effect.provide(platform)),
    );
    expect(seen.failures).toEqual([]);
    expect(seen.count).toBeGreaterThan(0);
    expect(seen.writers).toContain("agent:claude for:github:7");

    for (const writer of seen.writers) {
      expect(["agent:claude for:github:7", "agent:lead for:github:7"]).toContain(writer);
    }

    // Seed 119120 draws lines from its second run on, so a job began, and each one is an agent's.
    expect(seen.jobs.length).toBeGreaterThan(0);

    for (const writer of seen.jobs) {
      expect(["agent:claude for:github:7", "agent:lead for:github:7"]).toContain(writer);
    }
  });
});
