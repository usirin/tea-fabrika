import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, Exit, Fiber, Logger, type Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { memoryStorage, type Storage } from "../../program/storage.ts";
import { SummonManager, type TurnNews } from "../../shell/summon.ts";
import { summonManager } from "./manager.ts";

// The summon tryout, PR 1 (ticket 237), today's version: the real `SummonManager` on the fake
// ACP agent (../acp/fake-agent.ts), a child process spoken to over ACP with no model, so no test
// here spends a dollar. Each test works in a fresh git repository, as `acp --in repo` does for a
// summon. What the fake noted is read from its files: `.fake-acp/log` has one line per prompt,
// `prompt <session> <n> <first word>`, and `.fake-acp/<session>.jsonl` holds each session.
//
//   const manager = yield* SummonManager;            // summonManager({storage, folder}) in the layer
//   yield* manager.summon({agent: "fake", settings: ["fake-large", "high"], name: "scout", by})
//   manager.turn("scout", "read a.txt", null)        // told, status..., said (once, whole), result
//
// Laws S-4, S-5, S-6, S-7 and S-9 of the plan. S-3 is in manager.laws.test.ts.

const PERSON = "user:owner";

/** A fresh git repository with two files to read. */
const repo = () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "summon-")));
  execFileSync("git", ["init", "-q"], { cwd: folder });
  writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
  writeFileSync(join(folder, "b.txt"), "The bridge has 7 arches.\n");
  return folder;
};

/** The fake's prompt lines: `prompt <session> <n> <first word>`. */
const prompts = (folder: string) => {
  const at = join(folder, ".fake-acp", "log");
  return existsSync(at)
    ? readFileSync(at, "utf8")
        .split("\n")
        .filter((l) => l.startsWith("prompt "))
    : [];
};

/** The sessions the fake opened new: one file each. */
const sessions = (folder: string) => {
  const at = join(folder, ".fake-acp");
  return existsSync(at) ? readdirSync(at).filter((f) => f.endsWith(".jsonl")) : [];
};

/** Everything the fake kept of every session. */
const kept = (folder: string) =>
  sessions(folder)
    .map((f) => readFileSync(join(folder, ".fake-acp", f), "utf8"))
    .join("\n");

/** One host's life: the manager on `storage`, in `folder`, until `body` is done. */
const hosted = <A, E>(storage: Storage, folder: string, body: Effect.Effect<A, E, SummonManager | Scope.Scope>) =>
  Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(summonManager({ storage, folder }))));

/** Wait until `check` holds, `seconds` at most. */
const until = (what: string, check: () => boolean, seconds = 15) =>
  Effect.gen(function* () {
    for (let i = 0; i < seconds * 50; i += 1) {
      if (check()) {
        return;
      }

      yield* Effect.sleep(Duration.millis(20));
    }

    return yield* Effect.die(`waited ${seconds} seconds for ${what}`);
  });

/** A turn, run in the background: the news it sent so far, and its fiber. */
const turning = (name: string, prompt: string) =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;
    const got: TurnNews[] = [];
    const fiber = yield* manager.turn(name, prompt, null).pipe(
      Stream.runForEach((n) => Effect.sync(() => got.push(n))),
      Effect.forkChild,
    );
    return { got, fiber };
  });

/** A turn, run to its end: every piece of news, in order. */
const turned = (name: string, prompt: string) =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;
    return yield* manager.turn(name, prompt, null).pipe(Stream.runCollect);
  });

const summon = (name: string, settings: readonly string[] = [], agent = "fake") =>
  Effect.gen(function* () {
    const manager = yield* SummonManager;
    return yield* manager.summon({ agent, settings, name, by: PERSON });
  });

/** A refusal as text, whatever its shape: its fields and its message. */
const whyOf = (e: unknown) =>
  `${JSON.stringify(e)} ${e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? "")}`;

const TIME = 60_000;

describe("summon", () => {
  it(
    "starts the agent in the repo, sets two setting words as model then effort, and lists it idle",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const made = yield* summon("scout", ["fake-large", "high"]);
          const list = yield* (yield* SummonManager).list;
          return { made, list };
        }),
      );
      expect(seen.made).toMatchObject({
        name: "scout",
        agent: "fake",
        model: { typed: "fake-large", resolved: "fake-large" },
        effort: { typed: "high", set: "high" },
        folder,
        by: PERSON,
        state: "idle",
      });
      expect(seen.list.map((s) => [s.name, s.state])).toEqual([["scout", "idle"]]);
      // Opening a session calls no model: no prompt yet.
      expect(prompts(folder)).toEqual([]);
    },
    TIME,
  );

  it(
    "sorts one setting word into the list that has it: an effort alone leaves the model as the harness's",
    async () => {
      const folder = repo();
      const made = await hosted(memoryStorage(), folder, summon("scout", ["low"]));
      expect(made.effort).toEqual({ typed: "low", set: "low" });
      expect(made.model.typed).toBeNull();
      expect(made.model.resolved).toBe("fake-small");
    },
    TIME,
  );
});

describe("S-4: a setting word not in the harness's lists is refused with that list", () => {
  it(
    "refuses ultra, names fake's models and efforts, keeps no name, and sends no prompt",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const why = whyOf(yield* Effect.flip(summon("x", ["ultra"])));
          const after = yield* (yield* SummonManager).list;
          // The name was not taken: the same name, with no setting, is summoned.
          const again = yield* summon("x");
          return { why, after, again };
        }),
      );

      for (const word of ["ultra", "fake-small", "fake-large", "low", "medium", "high"]) {
        expect(seen.why).toContain(word);
      }

      expect(seen.after).toEqual([]);
      expect(seen.again.name).toBe("x");
      expect(seen.again.model.resolved).toBe("fake-small");
      expect(prompts(folder)).toEqual([]);
    },
    TIME,
  );

  it(
    "refuses a model word in the effort's place, and an agent there is none of",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const twice = whyOf(yield* Effect.flip(summon("x", ["fake-large", "fake-small"])));
          const agent = whyOf(yield* Effect.flip(summon("y", [], "nope")));
          return { twice, agent, list: yield* (yield* SummonManager).list };
        }),
      );
      expect(seen.twice).toContain("fake-small");
      expect(seen.agent).toContain("nope");
      expect(seen.list).toEqual([]);
      expect(prompts(folder)).toEqual([]);
    },
    TIME,
  );
});

describe("S-5: Ctrl-C's cancel ends the turn, not the agent", () => {
  it(
    "cancel mid-turn: the turn ends cancelled, scout is idle, and the next turn is n+1 in the same session",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const first = yield* turning("scout", "slowly read a.txt and b.txt");
          // The fake has the prompt: a turn runs.
          yield* until("the fake to hear the prompt", () => prompts(folder).length === 1);
          yield* manager.cancel("scout");
          yield* Fiber.join(first.fiber).pipe(Effect.timeout(Duration.seconds(10)));
          const idle = yield* manager.list;
          const next = yield* turned("scout", "hello again");
          return { first: first.got, idle, next };
        }),
      );
      expect(seen.first.at(-1)).toMatchObject({ _tag: "result", stop: "cancelled" });
      expect(seen.idle.map((s) => [s.name, s.state])).toEqual([["scout", "idle"]]);
      expect(seen.next.at(-1)).toMatchObject({ _tag: "result", stop: "end_turn" });
      const lines = prompts(folder).map((l) => l.split(" "));
      expect(lines).toHaveLength(2);
      const [one, two] = lines;
      expect(two?.[1]).toBe(one?.[1]);
      expect([one?.[2], two?.[2]]).toEqual(["1", "2"]);
      expect(sessions(folder)).toHaveLength(1);
    },
    TIME,
  );
});

describe("S-6: dismiss during a turn cancels the turn first, stops the run and frees the name", () => {
  it(
    "answers cut with the turn's number, lists nobody, lets the turn run no further, and the name is summoned again",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const first = yield* turning("scout", "slowly read a.txt and b.txt");
          yield* until("the fake to hear the prompt", () => prompts(folder).length === 1);
          yield* until("told", () => first.got.some((n) => n._tag === "told"));
          const told = first.got.find((n) => n._tag === "told");
          const dismissed = yield* manager.dismiss("scout", PERSON);
          const list = yield* manager.list;
          yield* Fiber.await(first.fiber).pipe(Effect.timeout(Duration.seconds(10)));
          // Long enough for the fake's slow turn to have answered, had it run on.
          yield* Effect.sleep(Duration.seconds(4));
          const again = yield* summon("scout");
          return { told, dismissed, list, again };
        }),
      );
      expect(seen.told).toEqual({ _tag: "told", turn: 1 });
      expect(seen.dismissed).toEqual({ cut: 1 });
      expect(seen.list).toEqual([]);
      expect(kept(folder)).not.toContain("agent_message_chunk");
      expect(seen.again.name).toBe("scout");
    },
    TIME,
  );

  it(
    "answers cut null when no turn ran",
    async () => {
      const folder = repo();
      const dismissed = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          yield* summon("scout");
          return yield* (yield* SummonManager).dismiss("scout", PERSON);
        }),
      );
      expect(dismissed).toEqual({ cut: null });
    },
    TIME,
  );
});

describe("S-7: a reply comes once, whole", () => {
  it(
    "a turn whose answer the fake sends in two chunks gives one said, between told and result",
    async () => {
      const folder = repo();
      const news = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          yield* summon("scout");
          return yield* turned("scout", "Read a.txt and b.txt, then say what each says.");
        }),
      );
      const said = news.filter((n) => n._tag === "said");
      expect(said).toHaveLength(1);
      const [reply] = said;
      expect(reply?._tag === "said" ? reply.text : "").toContain("a.txt: The river is called Kura.");
      expect(reply?._tag === "said" ? reply.text : "").toContain("b.txt: The bridge has 7 arches.");
      const tags = news.map((n) => n._tag);
      expect(tags[0]).toBe("told");
      expect(tags.at(-1)).toBe("result");
      expect(tags.indexOf("said")).toBeLessThan(tags.indexOf("result"));
      expect(news.at(-1)).toMatchObject({ _tag: "result", stop: "end_turn" });
    },
    TIME,
  );
});

describe("the ask: each edit waits for the person", () => {
  it(
    "an edit asks, nothing is written until it is answered, and an allow writes it",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const t = yield* turning("scout", "write it");
          yield* until("the ask", () => t.got.some((n) => n._tag === "ask"));
          const ask = t.got.find((n) => n._tag === "ask");
          let asking: readonly string[] = [];

          for (let i = 0; i < 100 && asking[0] !== "asking"; i += 1) {
            asking = (yield* manager.list).map((s) => s.state);

            if (asking[0] !== "asking") {
              yield* Effect.sleep(Duration.millis(20));
            }
          }

          const before = existsSync(join(folder, "written.txt"));

          if (ask?._tag !== "ask") {
            return yield* Effect.die("no ask");
          }

          // The plan's ask_answered records `by`: the manager is told who answered.
          yield* manager.answer("scout", ask.ask, true, PERSON);
          yield* Fiber.join(t.fiber).pipe(Effect.timeout(Duration.seconds(10)));
          return { ask, asking, before, news: t.got };
        }),
      );
      expect(seen.ask.title).toBe("Write written.txt");
      expect(seen.asking).toEqual(["asking"]);
      expect(seen.before).toBe(false);
      expect(existsSync(join(folder, "written.txt"))).toBe(true);
      expect(seen.news.at(-1)).toMatchObject({ _tag: "result", stop: "end_turn" });
    },
    TIME,
  );
});

describe("S-9: names are kept across a host restart", () => {
  it(
    "a host started again on the same storage lists scout, and its next turn is in the same session",
    async () => {
      const folder = repo();
      const storage = memoryStorage();
      const before = await hosted(
        storage,
        folder,
        Effect.gen(function* () {
          yield* summon("scout", ["fake-large"]);
          return yield* turned("scout", "hello");
        }),
      );
      expect(before.at(-1)).toMatchObject({ _tag: "result", stop: "end_turn" });
      const after = await hosted(
        storage,
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          // Reopened in the background at start: wait for it, as `agents` would show it.
          let listed: readonly { readonly name: string; readonly state: string }[] = [];

          for (let i = 0; i < 750; i += 1) {
            listed = yield* manager.list;

            if (listed.some((s) => s.name === "scout" && s.state === "idle")) {
              break;
            }

            yield* Effect.sleep(Duration.millis(20));
          }

          const exit = yield* Effect.exit(turned("scout", "again"));
          return { listed, exit };
        }),
      );
      expect(after.listed.map((s) => [s.name, s.state])).toEqual([["scout", "idle"]]);
      expect(Exit.isSuccess(after.exit)).toBe(true);
      const lines = prompts(folder).map((l) => l.split(" "));
      expect(lines).toHaveLength(2);
      const [one, two] = lines;
      expect(two?.[1]).toBe(one?.[1]);
      expect([one?.[2], two?.[2]]).toEqual(["1", "2"]);
      // The same session, opened again: never a second one.
      expect(sessions(folder)).toHaveLength(1);
    },
    TIME,
  );
});

// The host log lines the plan's "What this piece records" names, caught through Effect's own
// `Logger` in the format the host's file uses (host/main.ts), as agents-stop.test.ts does.
// Expected to fail on 8398b44f: ask_answered has no `by`, and turn_ended no tokens.

/** One log line's `key=value` fields, as `Logger.formatSimple` writes them, quotes taken off. */
const fieldsOf = (line: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const m of line.matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const [, key = "", raw = ""] = m;
    out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
  }

  return out;
};

/** One host's life, as `hosted`, and every log line it wrote. */
const logged = async <A, E>(folder: string, body: Effect.Effect<A, E, SummonManager | Scope.Scope>) => {
  const lines: string[] = [];
  const caught = Logger.make((o) => {
    lines.push(Logger.formatSimple.log(o));
  });
  const value = await Effect.runPromise(
    body.pipe(
      Effect.scoped,
      Effect.provide(summonManager({ storage: memoryStorage(), folder })),
      Effect.provide(Logger.layer([caught])),
    ),
  );
  return { value, lines };
};

/** The fields of each line whose message is `message`. */
const linesOf = (lines: readonly string[], message: string) => lines.map(fieldsOf).filter((f) => f.message === message);

describe("the host log records who answered and what a turn cost", () => {
  it(
    "ask_answered records by, the person who answered",
    async () => {
      const folder = repo();
      const { lines } = await logged(
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const t = yield* turning("scout", "write it");
          yield* until("the ask", () => t.got.some((n) => n._tag === "ask"));
          const ask = t.got.find((n) => n._tag === "ask");

          if (ask?._tag !== "ask") {
            return yield* Effect.die("no ask");
          }

          yield* manager.answer("scout", ask.ask, true, PERSON);
          yield* Fiber.join(t.fiber).pipe(Effect.timeout(Duration.seconds(10)));
        }),
      );
      const answered = linesOf(lines, "ask_answered");
      expect(answered).toHaveLength(1);
      expect(answered[0]).toMatchObject({ name: "scout", allow: "true", by: PERSON });
    },
    TIME,
  );

  // The fake reports tokens on every turn (fake-agent.ts: input 100 + the prompt's length,
  // output 10), so only the half where tokens come can be checked here. The half where a
  // harness gives none needs a fake that leaves `usage` out, which no prompt word does yet.
  it(
    "turn_ended records the turn's input and output tokens as the harness reported them",
    async () => {
      const folder = repo();
      const { lines } = await logged(
        folder,
        Effect.gen(function* () {
          yield* summon("scout");
          yield* turned("scout", "Read a.txt");
        }),
      );
      const ended = linesOf(lines, "turn_ended");
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({ name: "scout", stop: "end_turn", output: "10" });
      expect(Number(ended[0]?.input)).toBeGreaterThan(100);
    },
    TIME,
  );
});

describe("T237-4, the manager's side: a kept job finds its turn again", () => {
  it(
    "identify names the run behind a told turn, and refuses a turn or a name it never told",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          yield* turned("scout", "read a.txt");
          const identify = manager.identify!;
          return {
            one: yield* identify("scout", 1),
            two: whyOf(yield* Effect.flip(identify("scout", 2))),
            ghost: whyOf(yield* Effect.flip(identify("ghost", 1))),
          };
        }),
      );
      expect(seen.one).toEqual({ run: expect.stringMatching(/\S/) });
      expect(seen.two).toContain("scout: turn 2 is no longer available");
      expect(seen.ghost).toContain("ghost: turn 1 is no longer available");
    },
    TIME,
  );

  it(
    "a resumed turn that already ended plays its kept news, and tells the agent nothing again",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const first = yield* turned("scout", "read a.txt");
          const { run } = yield* manager.identify!("scout", 1);
          const again = yield* manager
            .turn("scout", "", null, { run, turn: 1 })
            .pipe(Stream.runCollect, Effect.timeout(Duration.seconds(10)));
          const other = whyOf(
            yield* Effect.flip(manager.turn("scout", "", null, { run: "another-run", turn: 1 }).pipe(Stream.runDrain)),
          );
          // Long enough for the fake to note a prompt, had one been told.
          yield* Effect.sleep(Duration.seconds(1));
          return { first: [...first], again: [...again], other };
        }),
      );
      const said = seen.first.find((n) => n._tag === "said");
      expect(said).toBeDefined();
      expect(seen.again.filter((n) => n._tag !== "status")).toEqual([
        said,
        expect.objectContaining({ _tag: "result", stop: "end_turn" }),
      ]);
      expect(seen.other).toContain("scout is a different agent now");
      expect(prompts(folder)).toHaveLength(1);
    },
    TIME,
  );

  it(
    "cancel leaves a turn alone unless it names that turn, and of that run when it names one",
    async () => {
      const folder = repo();
      const seen = await hosted(
        memoryStorage(),
        folder,
        Effect.gen(function* () {
          const manager = yield* SummonManager;
          yield* summon("scout");
          const first = yield* turning("scout", "slowly read a.txt and b.txt");
          yield* until("told", () => first.got.some((n) => n._tag === "told"));
          yield* manager.cancel("scout", { turn: 2 });
          yield* manager.cancel("scout", { turn: 1, run: "another-run" });
          yield* manager.cancel("ghost", { turn: 1 });
          const still = (yield* manager.list).map((s) => s.state);
          yield* manager.cancel("scout", { turn: 1 });
          yield* Fiber.join(first.fiber).pipe(Effect.timeout(Duration.seconds(10)));
          return { still, got: first.got };
        }),
      );
      expect(seen.still).toEqual(["turn"]);
      expect(seen.got.at(-1)).toMatchObject({ _tag: "result", stop: "cancelled" });
    },
    TIME,
  );
});

describe("the host log names who a turn was told to", () => {
  it(
    "turn_told records the name, the agent, its run and an empty room for a turn from no room",
    async () => {
      const folder = repo();
      const { value: run, lines } = await logged(
        folder,
        Effect.gen(function* () {
          yield* summon("scout");
          yield* turned("scout", "Read a.txt");
          return (yield* (yield* SummonManager).identify!("scout", 1)).run;
        }),
      );
      const told = linesOf(lines, "turn_told");
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ name: "scout", agent: "fake", run, room: "" });
    },
    TIME,
  );
});
