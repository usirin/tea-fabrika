import { DOOR, Ledger, MEMBERS, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Author, loadCell, saveCell } from "./ledger.ts";
import type { load, save } from "./machine.ts";
import { rowsOf } from "./rows.ts";

// The tracker's read names an agent's person from the ledger's members (`door/members`), the
// facts the door writes as people come. Here they are written by hand, on a ledger in memory.

describe("loading the tickets", () => {
  it("names the person an agent works for, and leaves a row from before the door alone", async () => {
    const ledger = memoryService();
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        // The door's stream is its own name's; on a ledger with no door, a claim writes it.
        const reg = yield* ledger.register(DOOR, "ledger");
        const { fence } = yield* ledger.claim(DOOR, "test", reg.rev, 60_000);
        yield* ledger.append(
          MEMBERS,
          "any",
          { kind: "founded", writer: "user:github:7", data: { id: "github:7", name: "alice" } },
          fence,
        );
        yield* ledger.register("tracker/ticket/1", "user:github:7");
        const inbox = streams("tracker/ticket/1").inbox;
        yield* ledger.send(inbox, "w1", {
          kind: "filed",
          writer: "user:github:7",
          data: { type: "filed", title: "Login fails", body: "" },
        });
        yield* ledger.send(inbox, "w2", {
          kind: "commented",
          writer: "agent:old-host for:github:7",
          data: { type: "commented", body: "Found it." },
        });
        yield* ledger.send(inbox, "w3", {
          kind: "commented",
          writer: "agent:review",
          data: { type: "commented", body: "Me too." },
        });
        const cmd = { after: 0 } as ReturnType<typeof load>;
        return (yield* loadCell(cmd)).entries;
      }).pipe(Effect.provideService(Ledger, ledger)),
    );
    expect(entries.map((e) => [e.by.id, e.whose])).toEqual([
      ["github:7", undefined],
      ["old-host", "alice"],
      ["review", undefined],
    ]);
    // The rows the window draws carry the name on.
    expect(rowsOf(entries).map((r) => r.whose)).toEqual([undefined, "alice", undefined]);
  });
});

// Record wide (docs/plan/pipeline-self-fix.md, PR 7): a person's comment names the run that was
// live when it was written, the ticket's last `started` with no `ended`. Code fills it in at the
// save; the person never types it. Missing means no run was live.
describe("saving a person's comment", () => {
  const lane = "agent:lane for:owner";
  const filed = { type: "filed", title: "Login fails", body: "" };
  const started = { type: "started", run: "r-build-1", stage: "build", task: null, log: null };
  const ended = {
    type: "ended",
    run: "r-build-1",
    stage: "build",
    outcome: { kind: "done", part: false },
    usd: 0,
    input: 0,
    output: 0,
    turns: 1,
  };

  it("names the run live when it was written, and no run once that run ended", async () => {
    const ledger = memoryService();
    const comments = await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.register("tracker/ticket/1", "user:owner");
        const inbox = streams("tracker/ticket/1").inbox;
        const send = (id: string, writer: string, data: { readonly type: string }) =>
          ledger.send(inbox, id, { kind: data.type, writer, data });
        const comment = (id: string, body: string) =>
          saveCell({ id, write: { kind: "comment", ticket: 1, body }, next: 1 } as ReturnType<typeof save>);
        yield* send("w1", "user:owner", filed);
        yield* comment("c1", "Before any run.");
        yield* send("r-build-1/started", lane, started);
        yield* comment("c2", "Skip part 2.");
        yield* send("r-build-1/ended", lane, ended);
        yield* comment("c3", "After it ended.");
        const rows = yield* ledger.readStream(inbox);
        return rows.filter((r) => r.kind === "commented").map((r) => JSON.parse(r.data));
      }).pipe(Effect.provideService(Ledger, ledger), Effect.provideService(Author, { kind: "user", id: "owner" })),
    );
    // Strict: with no run live, `during` is missing, never `undefined` or `null`.
    expect(comments).toStrictEqual([
      { type: "commented", body: "Before any run." },
      { type: "commented", body: "Skip part 2.", during: "r-build-1" },
      { type: "commented", body: "After it ended." },
    ]);
  });
});
