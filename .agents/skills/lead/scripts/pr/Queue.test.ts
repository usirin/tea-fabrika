// Today's lead tooling. Queue's laws (0162) on the test layers: nothing here asks GitHub, the
// tracker or the leak grep, and nothing sweeps. The laws of the retired catchup.sh that still have
// a job moved here: the state gate, the one pinned squash, and the ticket close of 0015 (T410).
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { ChecksError, type Job } from "../ci/Checks.ts";
import * as ChecksTest from "../ci/ChecksTest.ts";
import type { PullRequest } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import * as PushesTest from "./PushesTest.ts";
import * as Queue from "./Queue.ts";
import * as SweepsTest from "./SweepsTest.ts";
import * as TicketsCli from "./TicketsCli.ts";
import * as TicketsTest from "./TicketsTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";
const merged = "feedfacefeedfacefeedfacefeedfacefeedface";
const repo = "fixture/repo";

const State = Schema.Literals(["OPEN", "CLOSED", "MERGED"]);
/** How the required check stands at the head: not made yet, or one of GitHub's answers. */
const Required = Schema.Literals(["none", "queued", "in_progress", "success", "failure", "cancelled", "skipped"]);
const Leak = Schema.Literals(["clean", "leakChange", "leak", "leakText"]);

const job = (stands: typeof Required.Type): Option.Option<Job> =>
  stands === "none"
    ? Option.none()
    : stands === "queued" || stands === "in_progress"
      ? Option.some({ id: 1, status: stands, conclusion: null })
      : Option.some({ id: 1, status: "completed", conclusion: stands });

type World = {
  readonly state?: typeof State.Type;
  readonly draft?: boolean;
  readonly more?: PullRequestsTest.More;
  readonly required?: typeof Required.Type;
  readonly leak?: typeof Leak.Type;
  readonly open?: ReadonlyArray<number>;
  readonly failing?: {
    readonly prs?: PullRequestsTest.Failing;
    readonly tickets?: TicketsTest.Failing;
    readonly sweep?: string;
  };
};

/** Fresh memory for one run: GitHub with pull request 900, the leak grep, the tracker and the sweeps. */
const memory = (w: World = {}) => {
  const pr: PullRequest = { number: 900, head: "fabrikalfa/x", oid, state: w.state ?? "OPEN", draft: w.draft ?? false };
  const github = PullRequestsTest.world([pr]);
  github.more.set(900, { title: "T1: a title", body: "What it does.", ...w.more });
  const remote = PushesTest.remote();
  const tracker = TicketsTest.world(w.open ?? []);
  const sweeps = SweepsTest.count();
  const leak = w.leak === undefined || w.leak === "clean" ? {} : { [w.leak]: "private_word" };
  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github, w.failing?.prs),
    PushesTest.layer(remote, leak),
    ChecksTest.layer([job(w.required ?? "success")], ""),
    TicketsTest.layer(tracker, w.failing?.tickets),
    SweepsTest.layer(sweeps, w.failing?.sweep),
  );
  return { github, remote, tracker, sweeps, layer };
};

const add = (m: ReturnType<typeof memory>) => Queue.add({ dir: ".", pr: 900 }).pipe(Effect.provide(m.layer));
const settle = (m: ReturnType<typeof memory>) => Queue.settle({ repo, pr: 900 }).pipe(Effect.provide(m.layer));

describe("add: a finished pull request enters GitHub's merge queue by one pinned squash (0162)", () => {
  // Plants: ask the merge before a leak check; ask it on a red or unfinished head (which arms
  // auto-merge); ask it for a draft or a closed one; pin a head other than the one that was read.
  it.effect.prop(
    "property: it is asked once, pinned to the head that was read, only when the pull request is open, ready, into main, clean on all three leak checks and green on ci-required; any other world asks nothing",
    {
      state: State,
      draft: Schema.Boolean,
      base: Schema.Literals(["main", "fabrikalfa/parent"]),
      leak: Leak,
      required: Required,
    },
    ({ state, draft, base, leak, required }) =>
      Effect.gen(function* () {
        const m = memory({
          state,
          draft,
          more: { base, mergeCommit: state === "MERGED" ? merged : null },
          leak,
          required,
        });
        const answer = yield* Effect.result(add(m));
        const enters = state === "OPEN" && !draft && base === "main" && leak === "clean" && required === "success";
        expect(m.github.calls).toEqual(enters ? [{ _tag: "enqueue", number: 900, oid }] : []);
        expect(answer._tag === "Success" && answer.success._tag === "queued").toBe(enters);

        if (enters) {
          // Every leak check ran, on the head and on the words a squash puts on main, before the ask.
          expect(m.remote.calls).toEqual([
            `leakchange ${oid}`,
            `leakgrep ${oid}`,
            "leaktext T1: a title\n\nWhat it does.\n",
          ]);
        }

        // A pull request that may not enter is refused before anything is fetched or read.
        if (state !== "OPEN" || draft || base !== "main") {
          expect(m.remote.calls).toEqual([]);
        }
      }),
  );

  // vector: catchup.sh's own lines for a pull request that is not open and ready, kept word for word.
  it.effect("vector: merged is done and says where; closed, a draft and another base each refuse with one line", () =>
    Effect.gen(function* () {
      const done = yield* add(memory({ state: "MERGED", more: { mergeCommit: merged } }));
      expect(Queue.line(done)).toBe(`pr 900: already merged at ${merged}`);
      const closed = yield* Effect.flip(add(memory({ state: "CLOSED" })));
      expect(closed).toMatchObject({ _tag: "NotQueued", reason: "pr 900: closed, not merged" });
      const draft = yield* Effect.flip(add(memory({ draft: true })));
      expect(draft).toMatchObject({ reason: "pr 900: draft, not merged; refused until it is ready for review" });
      const stacked = yield* Effect.flip(add(memory({ more: { base: "fabrikalfa/parent" } })));
      expect(stacked).toMatchObject({ reason: "pr 900: merges into fabrikalfa/parent, not main; refused" });
    }),
  );

  it.effect("scenario: a queued answer says queued, never merged, and names the head", () =>
    Effect.gen(function* () {
      const answer = yield* add(memory());
      expect(answer).toEqual({ _tag: "queued", pr: 900, oid });
      expect(Queue.line(answer)).toBe(`pr 900: queued at ${oid}; GitHub tests it on newest main and merges it`);
    }),
  );

  it.effect(
    "scenario: a check that is not green names how it stands, and a pull request GitHub cannot show fails",
    () =>
      Effect.gen(function* () {
        const red = yield* Effect.flip(add(memory({ required: "failure" })));
        expect(red).toMatchObject({ _tag: "NotQueued" });
        expect(red._tag === "NotQueued" ? red.reason : "").toContain(`ci-required is failure at ${oid}`);
        const none = yield* Effect.flip(add(memory({ required: "none" })));
        expect(none._tag === "NotQueued" ? none.reason : "").toContain("ci-required is missing");
        const unread = memory({ failing: { prs: { view: "gh: offline" } } });
        expect((yield* Effect.flip(add(unread)))._tag).toBe("PullRequestsError");
        expect(unread.remote.calls).toEqual([]);
        const refused = memory({ failing: { prs: { enqueue: "gh: head moved" } } });
        expect((yield* Effect.flip(add(refused)))._tag).toBe("PullRequestsError");
      }),
  );

  // Plants: ask the merge while the check still runs; wait past the limit; never read again.
  it.effect(
    "scenario: a lane's wait reads the required check again until it ends, asks only on green, and gives up at its limit with nothing asked",
    () =>
      Effect.gen(function* () {
        const waited = (polls: ReadonlyArray<ChecksTest.Poll>) =>
          Effect.gen(function* () {
            const m = memory();
            const layer = Layer.merge(m.layer, ChecksTest.layer(polls, ""));
            const fiber = yield* Queue.add({ dir: ".", pr: 900, wait: { minutes: 5, every: 60 } }).pipe(
              Effect.provide(layer),
              Effect.result,
              Effect.forkChild,
            );
            yield* TestClock.adjust("6 minutes");
            return { answer: yield* Fiber.join(fiber), calls: m.github.calls };
          });
        const unreachable = new ChecksError({ reason: "gh: offline" });
        const green = yield* waited([job("none"), unreachable, job("in_progress"), job("success")]);
        expect(green.answer._tag).toBe("Success");
        expect(green.calls).toEqual([{ _tag: "enqueue", number: 900, oid }]);
        const red = yield* waited([job("queued"), job("failure")]);
        expect(red.answer._tag).toBe("Failure");
        expect(red.calls).toEqual([]);
        const never = yield* waited([job("in_progress")]);
        expect(never.answer._tag === "Failure" ? String(never.answer.failure.reason) : "").toContain(
          "ci-required is in_progress",
        );
        expect(never.calls).toEqual([]);
      }),
  );

  // Plants: add --admin or --auto; merge with another method; drop the head pin.
  it.prop(
    "property: the one merge call is a squash pinned to the head, with no --admin, no --auto and no other method",
    {
      number: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99999 })),
      head: Schema.Literals([oid, merged]),
    },
    ({ number, head }) => {
      const args = PullRequestsGh.mergeArgs(repo, number, head);
      expect(args).toEqual(["pr", "merge", String(number), "-R", repo, "--squash", "--match-head-commit", head]);
      return true;
    },
  );
});

describe("settle: a merged pull request closes the tickets it names (0015, T410)", () => {
  const phrase = /^[ \t]*fabrika close ticket [0-9]+[ \t]*$/;
  const note = `Closed by the merge of https://github.com/${repo}/pull/900, merge commit ${merged}.\n`;
  const landed = (body: string, w: World = {}) =>
    memory({ state: "MERGED", ...w, more: { body, mergeCommit: merged, ...w.more } });
  const closes = (m: ReturnType<typeof memory>) => m.tracker.posts.filter((p) => p._tag !== "list");
  const Noise = Schema.Array(
    Schema.Literals(["", "Done.", "close ticket 5", "fabrika close ticket", "ticket 5", "#5"]),
  );

  // Plant: match the phrase anywhere on a line, or close a ticket the description does not name.
  it.effect.prop("T410 property: a description with no phrase line closes nothing", { rows: Noise }, ({ rows }) =>
    Effect.gen(function* () {
      expect(rows.some((row) => phrase.test(row))).toBe(false);
      const m = landed(rows.join("\n"), { open: [5, 520] });
      const done = yield* settle(m);
      expect(m.tracker.posts).toEqual([]);
      expect(done.lines).toContain("pr 900: no fabrika close ticket line; closed no tickets");
    }),
  );

  // Plant: read GitHub's closing keywords, or a ticket trailer, as a close.
  it.effect(
    "T410 vector: GitHub's nine closing keywords and ticket trailers close nothing (GitHub docs, linking a pull request to an issue)",
    () =>
      Effect.gen(function* () {
        const keywords = ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"];
        const body = [
          ...keywords.flatMap((k) => [`${k} #5`, `${k.slice(0, 1).toUpperCase()}${k.slice(1)} #5`, `${k}: 5`]),
          "Ticket: 5",
          "Closes-ticket: 5",
          "T5 build: the fix",
        ].join("\n");
        const m = landed(body, { open: [5] });
        yield* settle(m);
        expect(m.tracker.posts).toEqual([]);
      }),
  );

  // Plant: accept the phrase with other text before or after it on the line.
  it.effect.prop(
    "T410 property: the phrase inside other text on its line closes nothing",
    { other: Schema.Literals(["-", "*", ">", "`", "#", "x.", "a:"]), before: Schema.Boolean },
    ({ other, before }) =>
      Effect.gen(function* () {
        const row = before ? `${other} fabrika close ticket 5` : `fabrika close ticket 5${other}`;
        const m = landed(`Done.\n${row}\n`, { open: [5] });
        yield* settle(m);
        expect(m.tracker.posts).toEqual([]);
      }),
  );

  // Plant: close only the first line's ticket, skip the comment, or close one already closed.
  it.effect.prop(
    "T410 property: each phrase line closes its open ticket once, with a comment naming the PR and the merge commit",
    {
      named: Schema.Literals([[7], [7, 410], [999, 3, 41]]),
      open: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean]),
      lead: Schema.Literals(["", " ", "\t", "  "]),
      trail: Schema.Literals(["", " ", "\t", "  "]),
      crlf: Schema.Boolean,
    },
    ({ named, open, lead, trail, crlf }) =>
      Effect.gen(function* () {
        const isOpen = (n: number) => open[named.indexOf(n as never)] === true;
        // A repeated line closes its ticket once.
        const rows = [
          "Done.",
          ...named.map((n) => `${lead}fabrika close ticket ${n}${trail}`),
          `fabrika close ticket ${named[0]}`,
        ];
        const m = landed(rows.join(crlf ? "\r\n" : "\n"), { open: named.filter(isOpen) });
        const done = yield* settle(m);
        expect(m.tracker.posts[0]).toEqual({ _tag: "list" });
        expect(closes(m)).toEqual(
          named.flatMap((n) =>
            isOpen(n)
              ? [
                  { _tag: "comment", ticket: n, body: note },
                  { _tag: "close", ticket: n },
                ]
              : [],
          ),
        );

        for (const n of named) {
          expect(done.lines).toContain(
            isOpen(n)
              ? `pr 900: closed ticket ${n}`
              : `pr 900: ticket ${n} is not open (already closed, or no such ticket); left as it is`,
          );
        }
      }),
  );

  // Plant: stop after the first ticket.
  it.effect("T410 scenario: two phrase lines close two tickets (the decision's own example)", () =>
    Effect.gen(function* () {
      const m = landed("Builds the close.\n\nfabrika close ticket 410\nfabrika close ticket 411\n", {
        open: [410, 411],
      });
      const done = yield* settle(m);
      expect(closes(m).map((p) => [p._tag, "ticket" in p ? p.ticket : null])).toEqual([
        ["comment", 410],
        ["close", 410],
        ["comment", 411],
        ["close", 411],
      ]);
      expect(done).toMatchObject({ _tag: "merged", commit: merged });
      expect(done.lines).toEqual([
        `pr 900: merged at ${merged}`,
        "pr 900: closed ticket 410",
        "pr 900: closed ticket 411",
      ]);
    }),
  );

  // Plant: close when GitHub does not say MERGED, when it names no merge commit, or when the pull
  // request merged into a branch that is not main.
  it.effect.prop(
    "T410 property: a pull request that is open, closed, a draft, unconfirmed or merged off main closes nothing and starts no sweep",
    {
      world: Schema.Literals([
        { state: "OPEN", draft: false, base: "main", commit: null },
        { state: "OPEN", draft: true, base: "main", commit: null },
        { state: "CLOSED", draft: false, base: "main", commit: null },
        { state: "MERGED", draft: false, base: "main", commit: null },
        { state: "MERGED", draft: false, base: "fabrikalfa/parent", commit: merged },
      ]),
    },
    ({ world }) =>
      Effect.gen(function* () {
        const m = memory({
          state: world.state,
          draft: world.draft,
          more: { body: "fabrika close ticket 5", base: world.base, mergeCommit: world.commit },
          open: [5],
        });
        const done = yield* settle(m);
        expect(done._tag).toBe("unmerged");
        expect(done.lines).toHaveLength(1);
        expect(done.lines[0]).toMatch(/^pr 900: .*; closed no tickets$/);
        expect(m.tracker.posts).toEqual([]);
        expect(m.sweeps.kicks).toBe(0);
      }),
  );

  // Plants: let tracker or sweep trouble fail the settle; close a ticket whose comment failed.
  it.effect.prop(
    "property: after a merge one sweep is started, and trouble with the tracker or the sweep is a line, never a failure",
    { failing: Schema.Literals(["none", "open", "comment", "close", "sweep"]) },
    ({ failing }) =>
      Effect.gen(function* () {
        const tickets =
          failing === "open" || failing === "comment" || failing === "close" ? { [failing]: "ERROR refused" } : {};
        const m = landed("fabrika close ticket 5", {
          open: [5],
          failing: { tickets, ...(failing === "sweep" ? { sweep: "no node" } : {}) },
        });
        const done = yield* settle(m);
        expect(done._tag).toBe("merged");
        expect(m.sweeps.kicks).toBe(1);
        expect(closes(m).map((p) => p._tag)).toEqual(
          failing === "open" ? [] : failing === "comment" ? ["comment"] : ["comment", "close"],
        );
        expect(done.lines.slice(1)).toEqual(
          {
            none: ["pr 900: closed ticket 5"],
            open: ["pr 900: cannot read the tracker; closed no tickets: 5"],
            comment: ["pr 900: ticket 5 not closed, the comment failed: ERROR refused"],
            close: ["pr 900: ticket 5 not closed: ERROR refused"],
            sweep: ["pr 900: closed ticket 5", "pr 900: box cleanup not started: no node"],
          }[failing],
        );
      }),
  );
});

describe("the tracker's command line, as TicketsCli reads it", () => {
  // format: `cli.ts post list` prints one line per open ticket, `<home>: #<n> <state> <title>`.
  it("format: only a line that names an open ticket counts, and a failure keeps the first ERROR line, never the stack", () => {
    const listed = ["home: #12 open Fix the door", "home: #13 closed Old", "posted", "home: #140 open #12 open again"];
    expect(TicketsCli.openIn(listed.join("\n"))).toEqual([12, 140]);
    expect(TicketsCli.firstError("  at file.ts:1\nERROR no such ticket\nERROR second")).toBe("ERROR no such ticket");
    expect(TicketsCli.firstError("  at file.ts:1")).toBe("no reason given");
  });
});
