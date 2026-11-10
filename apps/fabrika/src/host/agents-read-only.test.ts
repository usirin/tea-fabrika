import { Shell, Traces } from "@kampus/fabrika-old";
import { driveFor } from "@kampus/fabrika-old/mcp";
import { memoryService } from "@kampus/fabrika-old/memory";
import { memoryTraces } from "@tea-fabrika/trace/memory";
import { Effect, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { appPrograms } from "../tsh.ts";

// An agent's tools when its own login failed (tracker 185): on a connected home, an agent whose
// session could not be made is served the read-only door, never the person's session. Only the
// tools that write nothing (MCP's `readOnlyHint`), and a write tool called anyway is refused as
// any tool that is not there, before any run starts. Today's version. Nothing runs but the
// programs on a memory ledger; the fallback on a real host is in agents-shared.test.ts.
//
//   const {drive, tools} = yield* driveFor({list, tiles: () => [], readOnly: true});
//   tools.map((t) => t.name)                       // ["runs", ..., "tracker_query"]: each readOnlyHint
//   yield* drive.call("tracker_file", {value: {title: "x", body: ""}})
//   // {kind: "refused", why: "there is no tool tracker_file ..."}; the ledger holds no row

const traces = Effect.runSync(
  Effect.gen(function* () {
    return yield* Traces;
  }).pipe(Effect.provide(memoryTraces([]))),
);

/** The app's programs for the agent claude, on `ledger`, as the host packs them. */
const listOn = (ledger: ReturnType<typeof memoryService>) =>
  Shell.programList(
    appPrograms(ledger, { kind: "agent", id: "claude", for: "owner" }, { open: Effect.succeed([]) }, traces),
  );

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(test));

describe("an agent whose login was refused is served the read-only door", () => {
  it("are only the ones that write nothing", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const ledger = memoryService();
        const open = yield* driveFor({ list: listOn(ledger), tiles: () => [] });
        const shut = yield* driveFor({ list: listOn(ledger), tiles: () => [], readOnly: true });
        return { open: open.tools, shut: shut.tools };
      }),
    );
    // The default is the door as it is today, with every write.
    expect(seen.open.map((t) => t.name)).toContain("tracker_file");
    expect(seen.shut.length).toBeGreaterThan(0);

    for (const tool of seen.shut) {
      expect(tool.annotations).toEqual({ readOnlyHint: true });
    }

    const names = seen.shut.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["runs", "tracker_query"]));
    expect(names).not.toContain("tracker_file");
    expect(names).not.toContain("tracker_comment");
    // Every tool on the read-only door is one the open door marks read-only too: none is made up.
    const openHints = new Map(seen.open.map((t) => [t.name, t.annotations?.readOnlyHint]));

    for (const name of names) {
      if (name !== "job") {
        expect(openHints.get(name)).toBe(true);
      }
    }
  });

  it("refuses a write tool before any run starts, and nothing reaches the ledger", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const ledger = memoryService();
        const { drive } = yield* driveFor({ list: listOn(ledger), tiles: () => [], readOnly: true });
        const filed = yield* drive.call("tracker_file", {
          value: { title: "Not on this door", body: "" },
        });
        const comment = yield* drive.call("tracker_comment", { value: { ticket: 1, body: "No." } });
        const rows = yield* ledger.read(0, 100);
        const runs = yield* drive.call("runs", {});
        // A read still goes: the query reads the ledger and writes nothing.
        const query = yield* drive.call("tracker_query", { value: { status: "open" } });
        const after = yield* ledger.read(0, 100);
        return { filed, comment, rows, runs, query, after };
      }),
    );
    expect(seen.filed).toMatchObject({ kind: "refused", why: expect.stringMatching(/tracker_file/) });
    expect(seen.comment).toMatchObject({ kind: "refused" });
    expect(seen.rows).toEqual([]);
    expect(seen.runs).toMatchObject({ kind: "done", data: { yours: [] } });
    expect(seen.query).toMatchObject({ kind: "done" });
    expect(seen.after).toEqual([]);
  });
});
