import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import { Effect, Exit, FileSystem, type Path, Schedule, Scope } from "effect";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { gridOf } from "../editor/grid.ts";
import type { Down } from "../link.ts";
import { readToPage } from "../messages.ts";
import { go, home, options, plant, repo } from "../project.test-support.ts";
import type { Project } from "../project.ts";
import { appWire } from "../wire.ts";
import { runHost } from "./run.ts";
import { reach } from "./socket.ts";

const ops = fc.array(
  fc.record({
    index: fc.integer({ min: 0, max: 1 }),
    action: fc.constantFrom("counter", "summon", "split", "crash", "stale", "restart"),
  }),
  { minLength: 1, maxLength: 12 },
);

const separate = (a: readonly string[], b: readonly string[]) => {
  for (const value of a) {
    expect(b).not.toContain(value);
  }
};

const live = (sock: string) =>
  reach(sock).pipe(
    Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("5 seconds"),
  );

const pause = Effect.sleep("100 millis");

/** Wait until `ok` holds, 5 s at most. */
const until = (ok: () => boolean) =>
  Effect.sync(ok).pipe(
    Effect.repeat({ until: (held) => held, schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("5 seconds"),
  );

/** What a tile's terminal shows, as rows, wide enough that no line wraps. */
const rows = (got: readonly Down[], port: string) =>
  gridOf(
    got
      .flatMap((m) =>
        m.type === "to" && m.port === port && typeof m.m === "object" && m.m !== null
          ? [String(Reflect.get(m.m, "data"))]
          : [],
      )
      .join(""),
    200,
    1000,
  ).rows;

/** How many times a tile's terminal shows `line` typed at the prompt. */
const typed = (got: readonly Down[], line: string) =>
  rows(got, "tile:t1").filter((row) => row === `tsh$ ${line}`).length;

/** The tiles a host has opened a port for and drawn in. */
const drawn = (got: readonly Down[]) =>
  new Set(got.flatMap((m) => (m.type === "to" && m.port.startsWith("tile:") ? [m.port] : [])));

/**
 * Wait until every host's lines have been quiet for 150 ms, 5 s at most. A host that has just
 * opened a page draws its own prompt, and may redraw it a moment later; that is the sibling's own
 * line, not a line from the other host. The law (nothing of one host's work reaches the other's tile
 * or run) is checked from the quiet on, so a redraw cannot be taken for a crossing.
 */
const quiet = (lists: readonly (readonly unknown[])[]) =>
  Effect.gen(function* () {
    let last = lists.map((l) => l.length);
    let still = 0;

    for (let i = 0; i < 100 && still < 6; i += 1) {
      yield* Effect.sleep("25 millis");
      const now = lists.map((l) => l.length);
      still = now.every((n, at) => n === last[at]) ? still + 1 : 0;
      last = now;
    }
  });

it("P2: two real hosts keep equal tile and agent names, ledger files, jobs and ports separate", async () => {
  const { Project } = await import("../project.ts");
  await fc.assert(
    fc.asyncProperty(ops, async (operations) => {
      const app = home();
      const projects = await Promise.all(["left", "right"].map((name) => go(Project.check(repo(app, name)))));
      await go(
        Effect.gen(function* () {
          const hosts = [];

          for (const project of projects) {
            const paths = yield* Project.paths(app, project);
            const durable = join(app, "projects", project.key);
            const scope = yield* Scope.make();
            yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
            yield* runHost({
              home: durable,
              repo: project.root,
              project,
              settings: app,
              paths,
              pid: process.pid,
            }).pipe(Effect.provide(pullRequestsOf([])), Effect.scoped, Effect.forkIn(scope));
            yield* live(paths.sock);
            const got: Down[] = [];
            const socket = yield* NodeSocket.makeNet({ path: paths.sock });
            const wire = yield* appWire(socket, (m) => got.push(m), undefined, project.key);
            yield* wire.up;
            wire.send({ type: "page" });
            hosts.push({ project, paths, durable, got, wire, scope });
          }

          separate(
            [hosts[0]!.paths.sock, hosts[0]!.paths.mcp, hosts[0]!.durable],
            [hosts[1]!.paths.sock, hosts[1]!.paths.mcp, hosts[1]!.durable],
          );

          for (const h of hosts) {
            expect(statSync(h.paths.dir).mode & 0o777).toBe(0o700);

            for (const socket of [h.paths.sock, h.paths.mcp]) {
              expect(statSync(socket).mode & 0o777).toBe(0o600);
            }
          }

          for (const op of operations.filter((op) => !["crash", "stale", "restart"].includes(op.action))) {
            const h = hosts[op.index]!;
            const other = hosts[1 - op.index]!;
            yield* quiet(hosts.map((x) => x.got));
            const before = other.got.length;

            // Each op is waited out on its own host before the next one starts: a line until tsh
            // hands the prompt back after it, a split until the new tile is drawn. A summon prints
            // its `ready` only once the agent has started, which can take longer than the quiet
            // above; without this wait that late line of the host's own landed in the next op's
            // check as if the sibling had sent it (CI on PR 987).
            if (op.action === "split") {
              const tiles = drawn(h.got).size;
              h.wire.send({ type: "on", port: "desk", m: { type: "run", does: "tezgah.split" } });
              yield* until(() => drawn(h.got).size > tiles);
            } else {
              const line = op.action === "summon" ? "summon fake as scout" : "counter &";
              const times = typed(h.got, line);
              h.wire.send({ type: "on", port: "tile:t1", m: { type: "keys", data: `${line}\r` } });
              yield* until(() => typed(h.got, line) > times && rows(h.got, "tile:t1").at(-1) === "tsh$");
            }

            yield* pause;
            expect(
              other.got
                .slice(before)
                .filter((m) => m.type === "to" && (m.port === "tile:t1" || m.port.startsWith("run:"))),
            ).toEqual([]);
          }

          for (const h of hosts) {
            const pages = h.got.flatMap((m) => (m.type === "to" && m.port === "desk" ? [readToPage(m.m)] : []));
            expect(pages.some((p) => p.kind === "read" && p.msg.type === "desk")).toBe(true);
            // Real files, rather than two in-memory maps with invented project labels.
            expect(statSync(join(h.durable, "ledger.sqlite")).isFile()).toBe(true);
          }
        }),
      );
    }),
    { ...options, numRuns: 3 },
  );
});

// P2's plant, one wire or storage home for both, has no entry point to take it: each real host
// picks its own paths. The tests report gives the hand edit and says the box could not run it.

type Recover = (
  app: string,
  project: Project,
  why: "crash" | "stale" | "restart",
  sibling: { readonly sock: string },
) => Effect.Effect<unknown, unknown, FileSystem.FileSystem | Path.Path>;

/** P10's check: a crash, a stale cleanup or a restart of one project leaves its sibling's runtime files. */
const leavesSibling = async (recover: Recover, operations: typeof ops extends fc.Arbitrary<infer A> ? A : never) => {
  const { Project } = await import("../project.ts");
  const app = home();
  const projects = await Promise.all(["left", "right"].map((name) => go(Project.check(repo(app, name)))));
  const paths = await Promise.all(projects.map((project) => go(Project.paths(app, project))));

  for (const op of operations) {
    const why = op.action;

    if (why !== "crash" && why !== "stale" && why !== "restart") {
      continue;
    }

    const selected = projects[op.index]!;
    const sibling = paths[1 - op.index]!;
    await go(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(sibling.dir, { recursive: true, mode: 0o700 });

        for (const file of [sibling.sock, sibling.mcp, sibling.pid, sibling.lock]) {
          writeFileSync(file, "sibling fixture");
        }

        yield* recover(app, selected, why, sibling);

        for (const file of [sibling.sock, sibling.mcp, sibling.pid, sibling.lock]) {
          expect(readFileSync(file, "utf8")).toBe("sibling fixture");
        }
      }),
    );
  }
};

it("P10: crash, stale cleanup and restart touch only the chosen project's runtime files", async () => {
  const { Project } = await import("../project.ts");
  await fc.assert(
    fc.asyncProperty(ops, (operations) =>
      leavesSibling((app, project, why) => Project.recover(app, project, why), operations),
    ),
    options,
  );
});

// The plant: recovery clears the sibling's socket too.
plant("P10 remove a sibling socket", ops, async (operations) => {
  const { Project } = await import("../project.ts");
  await leavesSibling(
    (app, project, why, sibling) =>
      Project.recover(app, project, why).pipe(Effect.andThen(Effect.sync(() => rmSync(sibling.sock, { force: true })))),
    [...operations, { index: 0, action: "crash" }] as typeof operations,
  );
});

/** Every row of one record file, as written, once the file holds `min` rows (5 s at most). */
const rowsOf = (file: string, min: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (let i = 0; i < 200; i += 1) {
      const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
      const rows = text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      if (rows.length >= min) {
        return rows;
      }

      yield* Effect.sleep("25 millis");
    }

    return [];
  });

it("P2: a project's host names its project, root, settings and reason in its records", async () => {
  const { Project } = await import("../project.ts");
  const app = home();
  const project = await go(Project.check(repo(app, "named")));
  await go(
    Effect.gen(function* () {
      const paths = yield* Project.paths(app, project);
      const durable = join(app, "projects", project.key);
      const scope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
      yield* runHost({
        home: durable,
        repo: project.root,
        project,
        settings: app,
        paths,
        pid: process.pid,
      }).pipe(Effect.provide(pullRequestsOf([])), Effect.scoped, Effect.forkIn(scope));
      yield* live(paths.sock);
      const [host] = yield* rowsOf(join(durable, "records", "host.jsonl"), 1);
      expect(host).toMatchObject({
        kind: "host",
        project: project.key,
        root: project.root,
        pid: process.pid,
        settings: "shared",
        reason: "started",
      });
      const socket = yield* NodeSocket.makeNet({ path: paths.sock });
      const wire = yield* appWire(socket, () => undefined, undefined, project.key);
      yield* wire.up;
      wire.send({ type: "page" });
      wire.send({ type: "on", port: "tile:t1", m: { type: "keys", data: "summon fake as scout\r" } });
      const rows = yield* rowsOf(join(durable, "records", "agents.jsonl"), 1);
      expect(rows[0]).toMatchObject({ kind: "summon", project: project.key });
    }),
  );
});
