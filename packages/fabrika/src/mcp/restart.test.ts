import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { programList } from "../shell/programs.ts";
import { SMALL } from "../shell/small.ts";
import { driveFor } from "./drive.ts";
// made up: `RESTART`, `RESTART_TOOL` and `RestartRefused`, as stop.ts's `STOP`, `STOP_TOOL` and
// `StopRefused`. The plan names `RestartAsk` and `RestartAnswer`.
import { RESTART, RESTART_TOOL, RestartAnswer, RestartAsk, RestartRefused } from "./restart.ts";
import { STOP } from "./stop.ts";
import { callOf } from "./tools.ts";

// The host's `restart` tool, beside `runs`, `job` and `stop` (tracker 185b, PR 5): an agent
// restarts the host, and must say why. Today's version. The host answers first, then ends as
// SIGTERM ends it: every job stays in the table, detached. The app attached starts a host of its
// own build, so a restart with no app attached is refused: the host would stay down. It writes,
// so it is never on the read-only door; a second restart is a second restart, so it is not
// idempotent; it reaches nothing outside the host. MCP's four hints say so (spec 2025-11-25,
// "Tools"); a client treats them as hints only.
//
//   restart {why: "pick up the new build"}   {_tag: "restarting", detached: [12]}
//   restart {why: "..."}                     refused: "no app is attached to start a new host"
//   restart {}                               refused by the schema: the error names `why`

const LIST = programList(SMALL);

describe("the restart tool's schema", () => {
  it("is a host tool named restart, with no _, so it never equals a <program>_<input> name", () => {
    expect(RESTART).toBe("restart");
    expect(RESTART_TOOL.name).toBe(RESTART);
    expect(RESTART).not.toContain("_");
    expect(RESTART_TOOL.description.trim()).not.toBe("");
  });

  it("carries the spec's four hints: it writes, it is destructive, twice is not once, and it stays in the host", () => {
    expect(RESTART_TOOL.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("takes only a why of 1 to 500 characters, and requires it", () => {
    expect(RESTART_TOOL.inputSchema).toMatchObject({
      type: "object",
      properties: { why: { type: "string", minLength: 1, maxLength: 500 } },
    });
    // No other field: who restarts comes from the agent's handshake, never from what it sends.
    expect(Object.keys(RESTART_TOOL.inputSchema.properties ?? {})).toEqual(["why"]);
    expect([...(RESTART_TOOL.inputSchema.required ?? [])]).toEqual(["why"]);
    const asks = Schema.is(RestartAsk);
    expect(asks({ why: "pick up the new build" })).toBe(true);
    expect(asks({})).toBe(false);
    expect(asks({ why: "" })).toBe(false);
    expect(asks({ why: "x".repeat(500) })).toBe(true);
    expect(asks({ why: "x".repeat(501) })).toBe(false);
  });

  it("answers restarting, tagged by Effect, with the jobs it leaves detached", () => {
    const decode = Schema.decodeUnknownSync(RestartAnswer);
    expect(decode({ _tag: "restarting", detached: [12] })).toEqual({
      _tag: "restarting",
      detached: [12],
    });
    expect(decode({ _tag: "restarting", detached: [] })).toEqual({ _tag: "restarting", detached: [] });
    expect(() => decode({ _tag: "restarting" })).toThrow();
    expect(() => decode({ _tag: "restarting", detached: [1.5] })).toThrow();
    expect(() => decode({ _tag: "stopped", detached: [12] })).toThrow();
  });
});

describe("a restart call, read", () => {
  it("is read as a restart with what it asks", () => {
    // made up: the Call case `{kind: "restart", ask}`, as `stop` is `{kind: "stop", ask}` today.
    expect(callOf(LIST, RESTART, { why: "pick up the new build" })).toEqual({
      kind: "restart",
      ask: { why: "pick up the new build" },
    });
  });

  it("is refused when it gives no why, an empty one or one too long, and the refusal names why", () => {
    for (const args of [{}, { why: "" }, { why: "x".repeat(501) }, { why: 3 }]) {
      const call = callOf(LIST, RESTART, args);
      expect(call.kind, JSON.stringify(args)).toBe("refused");
      expect(call.kind === "refused" ? call.why : "").toMatch(/\bwhy\b/);
    }
  });

  it("is refused when its why holds a newline or another control character", () => {
    // The why is written to restart.json, the host's log, the top bar and each tile's line: one
    // line, nothing that moves a cursor or starts a line of its own.
    for (const why of [
      "pick up the new build\nlevel=INFO message=host_began after=restart",
      "pick up\r[1] done",
      "pick\u001b[2K up",
      "pick\u0000up",
    ]) {
      const call = callOf(LIST, RESTART, { why });
      expect(call.kind, JSON.stringify(why)).toBe("refused");
      expect(call.kind === "refused" ? call.why : "").toMatch(/\bwhy\b/);
    }

    expect(callOf(LIST, RESTART, { why: "yeni sürümü al" }).kind).toBe("restart");
  });
});

describe("the door's restart, as the host hands it", () => {
  const answer = RestartAnswer.make({ detached: [2] });

  it("lists no restart tool, and refuses a restart call, when the host hands no restart", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const { drive, tools } = yield* driveFor({
          list: LIST,
          tiles: () => [],
          job: () => null,
          stop: () => Effect.die("not asked"),
        });
        const called = yield* drive.call(RESTART, { why: "pick up the new build" });
        return { names: tools.map((t) => t.name), called };
      }).pipe(Effect.scoped),
    );
    expect(seen.names).toContain(STOP);
    expect(seen.names).not.toContain(RESTART);
    expect(seen.called).toMatchObject({ kind: "refused", why: expect.stringMatching(/restart/) });
  });

  it("lists restart beside the host's other tools, and hands the host only the why", async () => {
    const asked: unknown[] = [];
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const { drive, tools } = yield* driveFor({
          list: LIST,
          tiles: () => [],
          job: () => null,
          stop: () => Effect.die("not asked"),
          // made up: driveFor's `restart`, the host's restart handed to the door as `stop` is.
          restart: (ask: unknown) =>
            Effect.sync(() => {
              asked.push(ask);
              return answer;
            }),
        });
        const called = yield* drive.call(RESTART, { why: "pick up the new build" });
        return { names: tools.map((t) => t.name), called };
      }).pipe(Effect.scoped),
    );
    expect(seen.names.slice(0, 4)).toEqual(["runs", "job", STOP, RESTART]);
    expect(asked).toEqual([{ why: "pick up the new build" }]);
    expect(seen.called).toEqual({ kind: "done", data: { _tag: "restarting", detached: [2] } });
  });

  it("says the host's refusal in its words", async () => {
    const called = await Effect.runPromise(
      Effect.gen(function* () {
        const { drive } = yield* driveFor({
          list: LIST,
          tiles: () => [],
          restart: () => Effect.fail(new RestartRefused({ why: "no app is attached to start a new host" })),
        });
        return yield* drive.call(RESTART, { why: "pick up the new build" });
      }).pipe(Effect.scoped),
    );
    expect(called).toEqual({ kind: "refused", why: "no app is attached to start a new host" });
  });

  it("is not on the read-only door, and a call there is refused before the host is asked", async () => {
    let asked = 0;
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const { drive, tools } = yield* driveFor({
          list: LIST,
          tiles: () => [],
          job: () => null,
          restart: () => {
            asked += 1;
            return Effect.die("the read-only door asked the host to restart");
          },
          readOnly: { why: "the key: not a key" },
        });
        const called = yield* drive.call(RESTART, { why: "pick up the new build" });
        return { names: tools.map((t) => t.name), called };
      }).pipe(Effect.scoped),
    );
    expect(seen.names).not.toContain(RESTART);
    expect(seen.called).toMatchObject({ kind: "refused", why: expect.stringMatching(/restart/) });
    expect(asked).toBe(0);
  });
});
