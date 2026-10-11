import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import {
  type BriefRefusal,
  type Claimed,
  type DriverFact,
  Fabrika,
  type LaneView,
  ParkCause,
  type QueueReading,
  Shell,
  type Unknown,
  type Unparked,
} from "./fabrika.ts";

// `Fabrika` served by today's fabrika, version 0.9.0, through its CLI. A
// temporary Layer: the shells are still fabrika skills that read their brief
// from fabrika's lane and write their result to it, so for now the machine
// has to read that same lane (experiments/48-operator-from-six-moves.md). Each method
// runs one or two verbs from the repo's main checkout and turns stdout and
// the exit code into the service's typed answer. A code no rule here covers
// is "could not read or write at all", and the machine stops.
//
// The CLI has no key for a write, so this Layer keeps its own: a file of the
// intents it has written, with what each answered. A repeated intent is
// answered from the file.

export interface CliConfig {
  /** The repo's main checkout: verbs run here, and the lane's ledger is under it. */
  readonly repo: string;
  /** `owner/name`, for the issue's URL. */
  readonly slug: string;
  /** This driver's name to fabrika: its claim is made and released under it. */
  readonly session: string;
  /** Where the intents written are kept. */
  readonly journal: string;
  /** Hears every verb and how it ended, for a log. */
  readonly ran?: (verb: string, exit: number, stderr: string) => void;
}

interface Ran {
  readonly exit: number;
  readonly out: string;
  readonly err: string;
}

const TASK = "issue";
const unknown = Effect.fail<Unknown>({ _tag: "unknown" });

/** A park's leaf: `blocked`, `frozen`, or any `human:*`. Only there is the lane's `cause` a park's. */
const isPark = (leaf: string) => leaf === "blocked" || leaf === "frozen" || leaf.startsWith("human:");

export function cliFabrika(config: CliConfig) {
  const bin = join(config.repo, "node_modules", ".bin", "fabrika");

  /** One verb. It never rejects: a failure to start is exit -1. */
  const fabrika = (...args: readonly string[]): Effect.Effect<Ran> =>
    Effect.promise(
      () =>
        new Promise<Ran>((resolve) => {
          execFile(
            bin,
            [...args],
            { cwd: config.repo, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, FABRIKA_SESSION_ID: config.session } },
            (error, stdout, stderr) => {
              const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
              config.ran?.(args.join(" "), code, stderr.trim());
              resolve({ exit: code, out: stdout, err: stderr });
            },
          );
        }),
    );

  const json = <T>(ran: Ran): T => JSON.parse(ran.out) as T;

  // ------------------------------------------------------------ the journal

  const written = (): Record<string, unknown> =>
    existsSync(config.journal) ? (JSON.parse(readFileSync(config.journal, "utf8")) as Record<string, unknown>) : {};

  /** A write, once per intent: answered from the journal when it has the intent, written to it when the write answers. */
  const once = <A>(intent: string, write: Effect.Effect<A, Unknown>): Effect.Effect<A, Unknown> =>
    Effect.suspend(() => {
      const before = written();
      if (intent in before) return Effect.succeed(before[intent] as A);
      return Effect.tap(write, (answer) =>
        Effect.sync(() => {
          mkdirSync(dirname(config.journal), { recursive: true });
          writeFileSync(config.journal, `${JSON.stringify({ ...written(), [intent]: answer ?? null }, null, 2)}\n`);
        }),
      );
    });

  // ------------------------------------------------------------ reads

  interface Status {
    readonly stateValue: string | { readonly pipeline: Readonly<Record<string, string>> };
    readonly status: "active" | "done";
    readonly context: Readonly<Record<string, { readonly cause?: string } | readonly string[]>>;
  }
  interface Line {
    readonly task?: string;
    readonly event: string;
    readonly pr?: string;
  }

  const history = (lane: string) =>
    Effect.flatMap(fabrika("lane", "history", lane), (ran) => (ran.exit === 0 ? Effect.succeed(json<Line[]>(ran)) : unknown));

  /** A pull request's number, from its URL. The URL is the one `view` named: no verb is spent finding it again. */
  const prNumber = (url: string) => {
    const n = /\/pull\/(\d+)/.exec(url)?.[1];
    return n === undefined ? unknown : Effect.succeed(n);
  };

  const view = (lane: string): Effect.Effect<LaneView, Unknown> =>
    Effect.gen(function* () {
      const ran = yield* fabrika("lane", "status", lane);
      if (ran.exit !== 0) return yield* unknown;
      const status = json<Status>(ran);
      const lines = yield* history(lane);
      const pr = lines.filter((l) => typeof l.pr === "string").at(-1)?.pr ?? null;
      const issue = `https://github.com/${config.slug}/issues/${lane}`;
      const seq = lines.filter((l) => l.task === undefined || l.task === TASK).length;
      const task = (state: string, cause: ParkCause | null) => ({ task: TASK, state, cause, pr, seq });
      if (typeof status.stateValue === "string") {
        // A lane that tripped is not over: its task waits at a park a person can still open.
        if (status.stateValue === "tripped") {
          return { lane, issue, status: "active", tasks: [task("human:budget-spent", "repair-budget-spent")] };
        }
        const cancelled = status.stateValue === "board:cancelled";
        return { lane, issue, status: cancelled ? "cancelled" : "done", tasks: [] };
      }
      const leaf = status.stateValue.pipeline[TASK];
      if (leaf === undefined) return yield* unknown;
      const context = status.context[TASK];
      const raw = !Array.isArray(context) && isPark(leaf) ? (context as { cause?: string } | undefined)?.cause : undefined;
      const cause = ParkCause.safeParse(raw);
      return { lane, issue, status: "active", tasks: [task(leaf, cause.success ? cause.data : null)] };
    });

  // ------------------------------------------------------------ writes

  const REFUSALS: Readonly<Record<number, BriefRefusal>> = {
    18: "no_shell",
    19: "no_issue",
    20: "no_pr",
    22: "branch_unclear",
    25: "branch_unclear",
    59: "stale_branch",
    71: "size_stop",
  };

  /** The verbs that write one fact, in the order to try them. The first that fabrika takes wins. */
  function verbsFor(lane: string, fact: DriverFact, pr: string | null): readonly (readonly string[])[] {
    const at = [lane, "--task", TASK];
    const withPr = pr === null ? [] : ["--pr", pr];
    const report = (token: string, more: readonly string[] = []) => ["lane", "report", ...at, "--token", token, ...more];
    const park = (cause: ParkCause | null) => ["lane", "transition", lane, "BLOCKED", "--task", TASK, ...(cause === null ? [] : ["--cause", cause])];
    switch (fact.kind) {
      case "started":
        return [["lane", "transition", lane, "WIP", "--task", TASK]];
      case "token":
        return [report(fact.token, fact.pr === null ? withPr : ["--pr", fact.pr])];
      case "shell_dead":
        return [report("SHELL-DEAD", withPr), park("spawn-dead")];
      case "base_conflicted":
        // 0.9.0 takes the conflict lap out of `ship` only; anywhere else it is a park with that cause.
        return [report("BASE-CONFLICTED", ["--pr", fact.pr]), park("base-conflicted")];
      case "queue":
        return [report(fact.reading === "landed" ? "LANDED" : fact.reading === "ejected" ? "EJECTED" : "UNRESOLVED", withPr)];
      case "park":
        return [park(fact.cause)];
      case "rewind":
        return [["lane", "transition", lane, "WIP", "--task", TASK]];
    }
  }

  /** The codes that mean "fabrika read it and would not take it", against "could not run". */
  const REFUSED = new Set([8, 12, 22, 23, 24, 25, 32, 35, 36, 52, 55, 67, 72]);

  const record = (lane: string, fact: DriverFact, pr: string | null): Effect.Effect<boolean, Unknown> =>
    Effect.gen(function* () {
      // The merge queue parked the pull request: its merge intent comes off before the lane hears of it.
      if (fact.kind === "queue" && fact.reading === "parked" && pr !== null) {
        yield* fabrika("ship", "disarm", yield* prNumber(pr), "--site", "post-enqueue", "--json");
      }
      for (const verb of verbsFor(lane, fact, pr)) {
        const ran = yield* fabrika(...verb);
        if (ran.exit === 0) return true;
        if (!REFUSED.has(ran.exit)) return yield* unknown;
      }
      return false;
    });

  const claim = (lane: string): Effect.Effect<Claimed, Unknown> =>
    Effect.gen(function* () {
      const seats = yield* fabrika("lane", "seats");
      if (seats.exit !== 0) return yield* unknown;
      const seat = json<{ answer: string; retryAfter: string | null }>(seats);
      if (seat.answer === "full") return { won: false, why: "no_seat", detail: `retry after ${seat.retryAfter}` };
      const claimed = yield* fabrika("lane", "claim", lane);
      if (claimed.exit === 31) return { won: false, why: "held", detail: claimed.err.trim() };
      if (claimed.exit !== 0) return yield* unknown;
      const won = json<{ answer: string; token?: string; why?: string }>(claimed);
      if (won.answer !== "won" || won.token === undefined) return { won: false, why: "not_a_lane", detail: won.why ?? won.answer };
      const token = won.token;
      const status = yield* fabrika("lane", "status", lane);
      if (status.exit === 0) return { won: true, token };
      if (status.exit !== 7) return yield* unknown;
      // No lane yet: boot it. A refusal gives the claim back before it answers.
      const opened = yield* fabrika("lane", "open", lane, "--origin", "driver-pick");
      if (opened.exit === 0 || opened.exit === 14) return { won: true, token };
      yield* fabrika("lane", "release", lane, "--token", token);
      if (opened.exit === 51) return { won: false, why: "no_seat", detail: opened.err.trim() };
      if ([38, 46, 48, 63].includes(opened.exit)) return { won: false, why: "not_a_lane", detail: opened.err.trim() };
      return yield* unknown;
    });

  return Layer.succeed(Fabrika, {
    claim: ({ lane, intent }) => once(intent, claim(lane)),
    view,
    brief: ({ lane, task }) =>
      Effect.gen(function* () {
        const ran = yield* fabrika("lane", "brief", lane, "--task", task);
        const refusal = REFUSALS[ran.exit];
        if (refusal !== undefined) return { ok: false as const, why: refusal };
        if (ran.exit !== 0) return yield* unknown;
        const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(ran.out)?.[1]?.trim() ?? null;
        const shell = Shell.safeParse(field("shell"));
        const issue = field("issue");
        if (!shell.success || issue === null) return yield* unknown;
        return { ok: true as const, brief: { shell: shell.data, prompt: ran.out, issue, pr: field("pr") } };
      }),
    pr: ({ pr }) =>
      Effect.gen(function* () {
        const ran = yield* fabrika("build", "verdicts", "--pr", yield* prNumber(pr));
        if (ran.exit !== 0) return yield* unknown;
        const read = json<{ mergeability: "mergeable" | "conflicting" | "unknown"; requiredChecks: { state: string } }>(ran);
        const checks = read.requiredChecks.state;
        // Checks nobody can read are checks that have not settled.
        return { mergeable: read.mergeability, checks: checks === "green" || checks === "red" ? checks : ("pending" as const) };
      }),
    queue: ({ pr }) =>
      Effect.gen(function* () {
        const ran = yield* fabrika("ship", "reconcile", yield* prNumber(pr), "--polls", "1", "--json");
        if (ran.exit !== 0) return yield* unknown;
        const outcome = json<{ outcome: "landed" | "ejected" | "unresolved" | "parked" }>(ran).outcome;
        return (outcome === "unresolved" ? "waiting" : outcome) satisfies QueueReading;
      }),
    dispatched: ({ lane, task, intent }) =>
      Effect.asVoid(
        once(
          intent,
          Effect.gen(function* () {
            let ran = yield* fabrika("lane", "dispatched", lane, "--task", task);
            // 40: the ledger's lock is held for a moment. Once more.
            if (ran.exit === 40) ran = yield* fabrika("lane", "dispatched", lane, "--task", task);
            return ran.exit === 0 ? null : yield* unknown;
          }),
        ),
      ),
    record: ({ lane, fact, pr, intent }) => once(intent, record(lane, fact, pr)),
    unpark: ({ lane, task, intent }) =>
      once(
        intent,
        Effect.gen(function* () {
          const ran = yield* fabrika("recipe", "unpark", lane, "--task", task);
          const answers: Readonly<Record<number, Unparked>> = { 0: "cleared", 14: "cleared", 13: "not_yet", 12: "novel" };
          return answers[ran.exit] ?? (yield* unknown);
        }),
      ),
    clear: ({ lane, task, said, grant, intent }) =>
      once(
        intent,
        Effect.gen(function* () {
          const why = `A person answered the lane's question: ${said}`.slice(0, 600);
          if (grant) {
            const round = yield* fabrika("lane", "clear", lane, "--task", task, "--rationale", why);
            // 47: no budget was spent, so there is no round to grant; the unblock below is still the answer.
            if (round.exit !== 0 && round.exit !== 47) return REFUSED.has(round.exit) || round.exit === 66 ? false : yield* unknown;
          }
          const ran = yield* fabrika("lane", "transition", lane, "UNBLOCKED", "--task", task, "--rationale", why);
          if (ran.exit === 0) return true;
          return REFUSED.has(ran.exit) ? false : yield* unknown;
        }),
      ),
    finish: ({ lane, intent }) =>
      Effect.asVoid(
        once(
          intent,
          Effect.gen(function* () {
            let ran = yield* fabrika("lane", "record", lane);
            if (ran.exit === 8) ran = yield* fabrika("lane", "record", lane);
            // 49: the lane is complete and its issue is still open. The record is not posted; the run goes on to clean up.
            return ran.exit === 0 || ran.exit === 49 ? null : yield* unknown;
          }),
        ),
      ),
    release: ({ lane, token, intent }) =>
      Effect.asVoid(
        once(
          intent,
          Effect.gen(function* () {
            const ran = yield* fabrika("lane", "release", lane, "--token", token);
            // 31: nothing of this driver's stands, which is what a release is for.
            return ran.exit === 0 || ran.exit === 31 ? null : yield* unknown;
          }),
        ),
      ),
  });
}
