import { defineProgram, flag, jobTraceId, kind, output, type RefsOf, type Send } from "@kampus/fabrika-old";
import { Clock, Effect, Exit, Option, Ref, Schema, Stream } from "effect";
import { claim, newLane, release } from "../../asks/claims.ts";
import { readFacts, sendFact } from "../../asks/ledger.ts";
import { foldLedger } from "../../asks/rules.ts";
import { bookTarget } from "../../code-host-local.ts";
import { mustFail, mustPass } from "../../controls.ts";
import { planOf, readTicketId, type TicketId, ticketOf } from "../../ids.ts";
import type { AgentStep } from "../../settings.ts";
import { hashOf, sha256, textOf } from "../../tickets/approval.ts";
import {
  type Checked,
  type CodeFact,
  type Entry,
  FAILED_MOST,
  type FactOf,
  factsOf,
  type Hash,
  type Outcome,
  saidOf,
  TicketNumber,
} from "../../tickets/ticket.ts";
import { Tickets } from "../../tickets/tickets.ts";
import { inert } from "../build/body.ts";
import { examTouched } from "../build/check.ts";
import type { Built } from "../build/form.ts";
import { buildKind as buildStage, buildToTheEnd } from "../build/program.ts";
import type { Item } from "../build/ticket.ts";
import { type RedoOn, ruleFiles } from "../exam/machine.ts";
import { examChild, examToTheEnd } from "../exam/program.ts";
import { MAX_MUTANTS } from "../mutation/machine.ts";
import { mutationChild, mutationToTheEnd } from "../mutation/program.ts";
import { postsOf } from "../operate/machine.ts";
import { openItems } from "../operate/stop.ts";
import { nameOf } from "../outcome.ts";
import { revisionOfDraft } from "../plan/plan.ts";
import { planKind as planStage, planToTheEnd } from "../plan/program.ts";
import { planMarkdown, questionLines } from "../plan/render.ts";
import type { PushAsk } from "../push/machine.ts";
import { pushChild, pushToTheEnd } from "../push/program.ts";
import { reviewReadInterpret, reviewSubscribe } from "../review/handlers.ts";
import { Review, review } from "../review/machine.ts";
import { keepRows, type Reviewed } from "../review/program.ts";
import { shipReadInterpret, shipSubscribe, shipWriteInterpret } from "../ship/handlers.ts";
import { Ship, ship } from "../ship/machine.ts";
import { sortChild, sortToTheEnd } from "../sort/program.ts";
import { reviewLine, shipLine } from "../status.ts";
import type { PropertyId } from "../test-writer/brief.ts";
import { type RunFailure, testsOf } from "../test-writer/checked.ts";
import { answersChild, answersToTheEnd, TestsWork, testsChild, testsToTheEnd } from "../test-writer/program.ts";
import { DEFAULT_INCLUDES, includedBy } from "../test-writer/written.ts";
import { answerTags, LANE, reviewDrawing, shipDrawing, stepTags } from "../traced.ts";
import { LaneNow, pickedFor, type Picked, priceOf, stepStarted } from "./agents.ts";
import { fenced, listed, loadBrief, type Brief } from "./briefs.ts";
import type { Carried as Said } from "./carry.ts";
import { CheckRunner } from "./checks.ts";
import { examReady, folderWords, sentBack } from "./exam-pull.ts";
import { formatExam } from "./format.ts";
import {
  againstWords,
  codeSpan,
  decidedWords,
  foundWords,
  jobsList,
  mutantWords,
  money,
  redWords,
  ruleChangeLines,
  spentWords,
  throughWords,
  untestedRows,
  untestedWords,
  withRed,
} from "./found.ts";
import { answerHeard, ticketUrlOf } from "./hosts.ts";
import { type Inputs, keyOf } from "./key.ts";
import { leaveBehind } from "./leave.ts";
import {
  afterBuild,
  type AnswerWait,
  askedFor,
  type askPerson,
  type Carry,
  type claimLane,
  type Fresh,
  type freshMain,
  Lane,
  lane,
  MAX_ROUNDS,
  type readFiled,
  type releaseLane,
  type Resume,
  type runStep,
  STEPS,
  type StepEnd,
} from "./machine.ts";
import { FINAL, isEnd, LANE_NAMES } from "./outcome.ts";
import { carriedAt, examTarget, LanePulls, LaneWatch, PullWire, standsAt } from "./pulls.ts";
import { fold, seenOf } from "./restart.ts";
import { endTalk } from "./talk.ts";
import { LaneHome, LaneWork } from "./work.ts";

// The lane as a program: one tracker ticket through every step, each step's own machine, each step's
// facts on the ticket. Today's version. `pipeline` (programs/pipeline) starts this under an id named
// by the ticket, so typing the line again finds the lane where it stood.
//
//   lane_step {step: "build", count: 7, ...}
//     1. tells the agents who runs this step, from what brief, in what folder
//     2. writes `started`, with the brief's name and hash, under `r-build-7/started`, at once
//     3. runs build's own machine under the Act's intent, to its end; when its agent's session
//        opens, writes `session`, with the harness's own id for it, under `r-build-7/session`
//        (at the step's end instead, if that write failed; never, if no session opened)
//     4. writes `ended`, with both token counts and dollars, under `r-build-7/ended`
//     5. says one line
//
// The Act sent again after a kill finds the facts by their ids and the machine under its intent.

const unknown = { _tag: "unknown" as const };

/** A failure, with the words a person can act on where it has them. */
type Broke = { readonly _tag: string; readonly says?: string };

const OUTPUTS = {
  step: output(Schema.String, "One line per step as it ends, and per question as it is asked."),
  ended: output(
    Schema.Struct({ name: Schema.Literals(LANE_NAMES), said: Schema.String }),
    "Once: how the lane ended, and why.",
  ),
};

type Outputs = typeof OUTPUTS;

const buildChild = { ...buildStage, parent: "lane" as const };
const planChild = { ...planStage, parent: "lane" as const };

const reviewChild = kind({
  machine: review,
  state: Review,
  parent: "lane",
  options: () => ({
    ctx: undefined,
    interpret: { ...reviewReadInterpret, review_file_note: () => Effect.succeed("kept" as const) },
    subscribe: reviewSubscribe,
    terminal: (s: Review) => s.phase === "over",
  }),
  recovered: (s) => (s.phase === "idle" ? null : { type: "resume" }),
  drawing: ({ id }) => reviewDrawing(id, id),
  status: reviewLine,
});

const shipChild = kind({
  machine: ship,
  state: Ship,
  parent: "lane",
  options: () => ({
    ctx: undefined,
    interpret: { ...shipReadInterpret, ...shipWriteInterpret() },
    subscribe: shipSubscribe,
    terminal: (s: Ship) => s.phase === "over",
  }),
  recovered: (s) => (s.phase === "idle" ? null : { type: "resume" }),
  drawing: ({ id }) => shipDrawing(id, id),
  status: shipLine,
});

interface Stages {
  readonly send: Send<Outputs>;
  readonly machines: {
    readonly triage: RefsOf<typeof sortChild>;
    readonly plan: RefsOf<typeof planChild>;
    readonly exam: RefsOf<typeof examChild>;
    readonly tests: RefsOf<typeof testsChild>;
    readonly answers: RefsOf<typeof answersChild>;
    readonly build: RefsOf<typeof buildChild>;
    readonly mutation: RefsOf<typeof mutationChild>;
    readonly review: RefsOf<typeof reviewChild>;
    readonly push: RefsOf<typeof pushChild>;
    readonly ship: RefsOf<typeof shipChild>;
  };
}

/** A stage's outcome as the ticket's facts hold it: its five verbs and no more. Pure. */
export const factOutcome = (o: {
  readonly kind: string;
  readonly part?: boolean;
  readonly to?: string;
  readonly why?: string;
  readonly who?: string;
  readonly for?: string;
}): Outcome => {
  switch (o.kind) {
    case "done":
      return { kind: "done", part: o.part ?? false };
    case "send":
      return { kind: "send", to: o.to ?? "", why: o.why ?? "" } as Outcome;
    case "ask":
      return { kind: "ask", who: o.who ?? "", for: o.for ?? "" } as Outcome;
    case "skip":
      return { kind: "skip", why: o.why ?? "" } as Outcome;
    default:
      return { kind: "stuck", why: o.why ?? "" } as Outcome;
  }
};

/** Whether whoever filed a ticket is `person`, or an agent of theirs. Pure. */
export const filedBy = (
  by: { readonly kind: string; readonly id?: string; readonly for?: string } | undefined,
  person: string,
): boolean => by !== undefined && (by.kind === "agent" ? by.for === person : by.id === person);

/** The head `stage` left last, as its `ended` fact keeps it. `null`: none kept one. Pure. */
const headOf = (timeline: readonly Entry[], stage: string): string | null => {
  for (const { fact } of timeline.toReversed()) {
    if (fact.type !== "ended" || fact.stage !== stage) {
      continue;
    }

    const kept = Schema.decodeUnknownOption(ExamHead)(fact.carry);

    if (Option.isSome(kept)) {
      return kept.value.head;
    }
  }

  return null;
};

const ExamHead = Schema.Struct({ head: Schema.String });

/**
 * Whether a person answered which side was wrong about the test writer's files since the build last
 * ended: code put those files back, or the test writer wrote them again, under the builder. Pure.
 */
const examPickedSinceBuild = (timeline: readonly Entry[]): boolean => {
  const built = timeline.findLastIndex(({ fact }) => fact.type === "ended" && fact.stage === "build");
  return timeline.slice(built + 1).some(({ fact }) => {
    if (fact.type !== "answered") {
      return false;
    }

    const kind = askedFor(String(fact.ask));
    return kind === "exam_touched" || kind === "exam_conflict";
  });
};

/** The head of the test writer's last commit. Pure. */
const examHeadOf = (timeline: readonly Entry[]): string | null => headOf(timeline, "test_writer");

/** A file main changed while the lane was stopped, where main's side now stands: the step that redoes it reads it. Pure. */
const conflictItem = (file: string, base: string | null, onto: string): Item => ({
  criterion: null,
  text: `${file} conflicted with main, which moved from ${base ?? "where the lane left it"} to ${onto}. Main's version of it now stands.`,
  says: `Main changed ${file} while the lane was stopped. Main's side was kept, and this lane's change to it is gone.`,
  where: [file],
  wants: [`${file} does again what this lane needs, on top of main's version`],
});

/** What a fresh read found, with what it changed: every kind but a closed ticket's and another's. */
type Found = Exclude<Fresh, { readonly _tag: "closed" | "not_yours" }>;

/**
 * The lane's branch on main as read fresh: what was found, the files where main's side won, and the
 * ref the old head stays under when the branch started again from main.
 */
interface Put {
  readonly found: Found;
  readonly conflicts: readonly string[];
  readonly kept?: string;
}

/**
 * The lane goes on at a step before the test writer, such as an old save whose fold names `plan`
 * (self-fix PR 5), or at a first test writer (tracker 194): nothing on its branch stands, so the
 * branch starts again from `onto`, and the old head stays under a ref the restart names. Nothing
 * built: the branch moves to `onto` as it is, and what the test writer wrote, touched and could not
 * test goes with it.
 */
const startOver = (cmd: ReturnType<typeof freshMain>, onto: string) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const { head } = cmd.carry;
    const kept = head === null || head === onto ? undefined : `refs/kept/${cmd.intent}`;

    if (head !== null && kept !== undefined) {
      yield* work.keep(head, kept);
    }

    yield* work.reset(cmd.number, onto);
    const put: Put = {
      found: {
        _tag: "fresh",
        carry: { base: onto, head: onto, exam: [], written: null, touched: [], cannot: [] },
      },
      conflicts: [],
      ...(kept === undefined ? {} : { kept }),
    };
    return put;
  });

/**
 * Whether a restart that goes on from `from` starts the branch again from main: before the test
 * writer, or at a first test writer (tracker 194). That writer's commit was never checked on main,
 * and it writes every test again anyway, so its commit is kept under a ref and never rebased: a
 * rebase onto a main that added the same file would ask `exam_conflict`, and a redo of that file
 * alone leaves the rest unproven. A run as the next round is no first. `round` left out: a read sent
 * before it, as before. Pure.
 */
const startsOver = (from: Resume, round: number | undefined): boolean =>
  STEPS.indexOf(from.step) < STEPS.indexOf("test_writer") ||
  (from._tag === "run" && from.step === "test_writer" && from.round === undefined && round === 1);

/**
 * Ticket `cmd.number`'s branch moved to main's tip, read fresh, once the exam's pull request merged
 * (tracker 194). A commit on the branch that main lacks stays under a ref named by the step's intent
 * first. Answers the tip.
 */
const onNewMain = (cmd: Carried) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const tip = yield* work.main;
    const { tree } = yield* work.tree(cmd.number);
    const head = yield* work.head(tree);

    if ((yield* work.mergeBase(head, tip)) !== head) {
      yield* work.keep(head, `refs/kept/${cmd.intent}`);
    }

    yield* work.reset(cmd.number, tip);
    return tip;
  });

/**
 * The lane's branch put on `onto` (self-fix PR 5). Never pushed: the test writer's own commit is
 * rebased first, then the builder's commits onto it, so its check runs again on main and a conflict
 * in its files is told from one in the builder's. Pushed: main is merged in, and the head that was
 * pushed stays under the new one. In every conflict main's side stands.
 */
const putOnMain = (cmd: ReturnType<typeof freshMain>, onto: string) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const tickets = yield* Tickets;
    const { number, carry } = cmd;
    const { base, head, pr, exam, open } = carry;
    const written = carry.written ?? undefined;
    const answer = (f: Found, conflicts: readonly string[] = []): Put => ({ found: f, conflicts });

    if (base === null || head === null || base === onto) {
      return answer({ _tag: "fresh", carry: {} });
    }

    const pushed = pr !== null;
    const first = pushed || written === undefined ? null : yield* work.onMain(number, written.commit, onto, false);
    const put =
      first === null
        ? yield* work.onMain(number, head, onto, pushed)
        : yield* work.onMain(number, head, first.head, false, written?.commit);
    const moved: StepEnd["carry"] = {
      base: onto,
      head: put.head,
      ...(first === null || written === undefined ? {} : { written: { ...written, commit: first.head } }),
    };
    const conflicts = [...(first?.conflicts ?? []), ...put.conflicts];

    if (conflicts.length > 0) {
      yield* tickets
        .talk(number, `${cmd.intent}/conflicts`, {
          type: "commented",
          body: saidOf(
            [
              `Main moved from ${base} to ${onto} while the lane was stopped, and these files conflicted with it. Main's side now stands in each:`,
              listed(conflicts.map(codeSpan)),
            ].join("\n"),
          ),
        })
        .pipe(Effect.ignore);
    }

    // The test writer's files: it writes them again on main, and the build goes on from its own work.
    const tests = conflicts.filter((file) => exam.includes(file));

    if (tests.length > 0) {
      return answer({ _tag: "exam_conflict", files: tests, carry: { ...moved, touched: tests } }, conflicts);
    }

    if (conflicts.length > 0) {
      return answer(
        {
          _tag: "conflicts",
          files: conflicts,
          carry: {
            ...moved,
            open: [...open, ...conflicts.map((file) => conflictItem(file, base, onto))],
          },
        },
        conflicts,
      );
    }

    // The test writer's check again, on its commit put on main: each new test still fails there, each
    // existing one still passes. A file whose test does not is the test writer's to write again.
    const off = first === null || written === undefined ? [] : yield* offOnMain(carry, first.head, written);

    if (off.length > 0) {
      yield* tickets
        .talk(number, `${cmd.intent}/off`, {
          type: "commented",
          body: saidOf(
            [
              `On main as it is now (${onto}), these tests no longer fail or pass as the plan says:`,
              listed(off.map(codeSpan)),
            ].join("\n"),
          ),
        })
        .pipe(Effect.ignore);
      return answer({ _tag: "exam_conflict", files: off, carry: { ...moved, touched: off } });
    }

    if (pr === null) {
      return answer({ _tag: "fresh", carry: moved });
    }

    // What the review judged, at the merged head: kept, and it stands there; else it reads it again.
    return answer({ _tag: "merged", carry: moved, review: yield* reviewAt(number, pr, put.head) });
  });

/**
 * A route's fresh read (jidoka row 62): the head with main merged in goes through the push stage once
 * its checks are green and the review stands there, as the push step would put it there, since the
 * step the route runs next is ship, and ship merges only what the pull request holds. A restart's
 * read, the guard's, or one where the review does not stand pushes nothing: the push step runs after
 * it. A push that does not end done fails the read.
 */
const pushedIfRouted = <F extends Found>(
  refs: Stages["machines"]["push"],
  cmd: ReturnType<typeof freshMain>,
  ticket: { readonly title: string },
  found: F,
  green: boolean,
) =>
  Effect.gen(function* () {
    const head = found.carry?.head;

    if (cmd.routed !== true || found._tag !== "merged" || !green) {
      return found;
    }

    // Where the review does not stand, it reads the head first: the push would post its old
    // verdicts at a head it never judged. The push step puts the head there after (`freshAt`).
    if (found.review._tag !== "kept") {
      return found;
    }

    if (head === undefined || head === null) {
      return found;
    }

    const { repo } = yield* (yield* LaneWork).origin;
    const carry: Carry = { ...cmd.carry, ...found.carry };
    const on = { url: ticketUrlOf(repo, cmd.number), number: cmd.number, title: ticket.title };
    const outcome = yield* pushedBy(refs, cmd.intent, `${cmd.intent}/pushed`, {
      ask: pushAsk(on, head, carry),
      base: carry.base ?? head,
    });

    if (outcome.kind !== "done") {
      return yield* Effect.fail({
        _tag: "unknown",
        says: `the head with main in it was not pushed: ${nameOf(outcome)}`,
      });
    }

    return found;
  });

/** What the push stage is asked for `head`: the pull request's words, from what the carry says. Pure. */
const pushAsk = (
  ticket: { readonly url: string; readonly number: number; readonly title: string },
  head: string,
  carry: Carry,
): PushAsk => {
  const passed = [...untestedWords(carry.untested ?? []), ...throughWords(carry.through)];
  return {
    ticket: ticket.url,
    number: ticket.number,
    head,
    title: ticket.title,
    // Named in words: this text must not close a number on the code host. Nor may an agent's.
    body: saidOf(
      [
        `From tracker ticket ${ticket.number}.`,
        "",
        inert(carry.plan?.summary ?? ""),
        "",
        // "No deviations" would read as all clear, beside what a person let through.
        ...(carry.deviations.length > 0
          ? [listed(carry.deviations.map(inert))]
          : passed.length === 0
            ? ["No deviations."]
            : []),
        ...((carry.left ?? []).length === 0
          ? []
          : ["", "What the builder could not do:", listed((carry.left ?? []).map(inert))]),
        ...(passed.length === 0 ? [] : ["", ...passed]),
      ].join("\n"),
    ),
    posts: carry.posts,
  };
};

/**
 * `ask.head` put on the remote by the push stage, under `intent`: the branch, the pull request, and
 * the review's verdicts on it. Done: the ticket says what was pushed since `base`, under `key`, and
 * the lane watches the pull request.
 */
const pushedBy = (
  refs: Stages["machines"]["push"],
  intent: string,
  key: string,
  { ask, base }: { readonly ask: PushAsk; readonly base: string },
) =>
  Effect.gen(function* () {
    const end = yield* pushToTheEnd(refs, intent, ask);

    if (end.outcome.kind !== "done") {
      return end.outcome;
    }

    yield* (yield* Tickets).write(ask.number, key, {
      type: "pushed",
      head: ask.head,
      commits: yield* (yield* LaneWork).commits(base, ask.head),
    });
    yield* (yield* LaneWatch).look(ask.number, end.outcome.pr);
    return end.outcome;
  });

/**
 * What `carry` says of the verdicts posted on `pr` at `head`, with the `carried` fact for a kept one.
 * None posted with what they judged (a lane from before), or a read that broke: stale, as before.
 */
const reviewAt = (number: number, pr: string, head: string) =>
  Effect.gen(function* () {
    const pull = yield* (yield* LanePulls).find(pr);

    if (pull.posted === undefined) {
      return { _tag: "stale" } as const;
    }

    return yield* carriedAt(number, pull.posted, head);
  }).pipe(Effect.orElseSucceed((): Said => ({ _tag: "stale" })));

/**
 * The files of the test writer's tests that, run on `commit`, no longer do what the plan's Properties
 * say: a `new` one's test green there, an `existing` one's red.
 */
const offOnMain = (carry: Carry, commit: string, written: Redo["written"]) =>
  Effect.gen(function* () {
    if (written.tests.length === 0) {
      return [];
    }

    const results = yield* (yield* TestsWork).onBase(commit, written.tests);
    const behaviors = new Map<string, string>(propertiesOf(carry, 1).map((p) => [p.id, p.behavior]));
    const off = results.flatMap(({ property, result }) => {
      const behavior = behaviors.get(property);

      if (behavior === undefined) {
        return [];
      }

      const control = behavior === "new" ? mustFail(result) : mustPass(result);
      return control.kind === "ok" ? [] : written.tests.filter((t) => t.property === property).map((t) => t.file);
    });
    return [...new Set(off)];
  });

/** A redo the test writer owes: the files a person sent back, and its own commit to write them on. */
interface Redo {
  readonly files: readonly string[];
  readonly written: NonNullable<Carry["written"]>;
}

/**
 * Where a test writer adds its tests: main in round 1, and the head from round 2 on. One sent back
 * while its own commit is still the head starts where that commit did, so its own files are never
 * ones that exist already (jidoka row 28). `null`: no head to add tests on. Pure.
 */
const testsBase = (carry: Carry, round: number, main: string): string | null => {
  if (round === 1) {
    return main;
  }

  const { wrote, head } = carry;
  return wrote !== undefined && wrote.commit === head ? wrote.base : head;
};

/** The redo `carry` holds, if any. Pure. */
const redoOf = (carry: Carry): Redo | null => {
  const files = carry.touched ?? [];
  const written = carry.written ?? null;
  return files.length === 0 || written === null ? null : { files, written };
};

/**
 * The test writer writes the files a person sent back again, on its own commit and never on the
 * builder's work (self-fix PR 5): only those files, for the Properties tested in them, told what the
 * person wrote. Its check runs there. When that check passes, the new files are laid on the builder's
 * head, where the build goes on.
 */
const writtenAgain = (at: At, redo: Redo) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const settings = yield* work.settings;
    const { carry, round, number } = at.cmd;
    const head = yield* need(carry.head, "no head to put the tests on");
    const on = redo.written.commit;
    const sent = new Set(redo.files);
    const ids = new Set<string>(redo.written.tests.filter((t) => sent.has(t.file)).map((t) => t.property));
    const all = propertiesOf(carry, 1);
    const properties = ids.size === 0 ? all : all.filter((p) => ids.has(p.id));
    const includes = settings.test_writer?.includes ?? [...DEFAULT_INCLUDES];
    const taken = (yield* work.judgedFiles(on)).filter(includedBy(includes));
    const version = (carry.version ?? 1) + round - 1;
    const summary = carry.plan?.summary ?? at.title;
    const pointers = carry.plan?.pointers ?? [];
    yield* work.reset(number, on);
    yield* at.tell(yield* work.judgeCopy(on), "read", {
      ticket: ticketWords(at),
      plan: `Version ${version}. ${summary}`,
      jobs: jobsList(carry.plan),
      base: on,
      properties: fenced(JSON.stringify(properties, null, 1), "json"),
      interface: carry.plan?.interface === undefined ? "None." : fenced(carry.plan.interface, "ts"),
      pointers: listed(pointers.map((p) => `${p.at}: ${p.why}`)),
      includes: listed(includes),
      taken: listed(taken),
      test_command: (settings.test_writer?.run ?? []).join(" "),
      decided: decidedWords(carry),
      redo: listed(redo.files.map(codeSpan)),
      note: "",
    });
    const end = yield* testsToTheEnd(at.stages.tests, at.cmd.intent, {
      ticket: at.url,
      plan: { version, summary },
      base: on,
      properties,
      pointers,
      includes,
      tries: 3,
      rewrite: redo.files,
    });
    const commit = end.report.commit;
    const answers = end.report.written?.answers ?? [];
    const problems = [...end.report.problems, ...foundWords(properties, end.report.found, answers)];
    // Back on the builder's work, which the build goes on from.
    yield* work.reset(number, head);
    // The redo goes on the head only when its check on the base came out as the plan says: `done`,
    // or `cannot_test`, where every test it wrote did and a person lets the rest through. Any other
    // end, an ask or a stop, keeps the carry as it was, so the redo stays owed: the route's rerun
    // and a person's `again` are the redo again, on the commit it started from, and no build starts
    // on tests the base never passed (test-writer/machine.ts).
    const passed = end.outcome.kind === "done" || (end.outcome.kind === "ask" && end.outcome.for === "cannot_test");

    if (commit === null || !passed) {
      return withFailure(ended(end.outcome, {}, problems), end.report.failure);
    }

    const files = yield* work.filesOf(work.at("clone"), commit);
    const next = yield* work.putBack(number, commit, files, `the test writer's files, written again, for ${at.url}`);
    const done = ended(
      end.outcome,
      {
        head: next,
        touched: [],
        exam: [...carry.exam, ...files.filter((file) => !carry.exam.includes(file))],
        written: {
          commit,
          tests: [
            ...redo.written.tests.filter((t) => !sent.has(t.file)),
            ...testsOf(answers).map(({ property, file, name }) => ({ property, file, name })),
          ],
        },
        cannot: untestedRows(properties, answers),
      },
      problems,
    );
    return withFailure(done, end.report.failure);
  });

const AGENT_STEPS: Partial<Record<Carried["step"], { readonly step: AgentStep; readonly brief: string }>> = {
  triage: { step: "triage", brief: "triage.md" },
  plan: { step: "plan", brief: "plan.md" },
  exam: { step: "exam", brief: "exam.md" },
  test_writer: { step: "test_writer", brief: "test-writer.md" },
  mutants: { step: "test_writer", brief: "test-writer-mutants.md" },
  build: { step: "build", brief: "build.md" },
  review: { step: "review", brief: "review.md" },
  // The exam's pull request gets the same review, with the same brief, over its own criteria.
  exam_review: { step: "review", brief: "review.md" },
};

type Carried = ReturnType<typeof runStep>;

/** What a step's body has to hand. */
interface At {
  readonly cmd: Carried;
  readonly repo: string;
  readonly url: string;
  readonly id: TicketId;
  readonly run: string;
  readonly picked: Picked | null;
  readonly brief: Brief | null;
  readonly title: string;
  readonly body: string;
  readonly tell: (
    folder: string,
    access: "read" | "write",
    slots: Readonly<Record<string, string>>,
  ) => Effect.Effect<void>;
  readonly stages: Stages["machines"];
}

/** The ticket's title and text, for a brief: its url is no way to the words, in a box with no network. */
const ticketWords = (at: At) => fenced(`# ${at.title}\n\n${at.body}`, "markdown");

const budgetOf = (at: At) => ({
  model: at.picked?.model ?? "",
  effort: at.picked?.effort ?? "high",
  budget: at.picked?.usd ?? 1,
});

const need = <A>(value: A | null | undefined, says: string): Effect.Effect<A, Broke> =>
  value === null || value === undefined ? Effect.fail({ _tag: "unknown", says }) : Effect.succeed(value);

/**
 * A step's end, and what its machine said went wrong: the ticket and the tile say it too. `failed`:
 * on a red head, each failing test by name, for the step's `ended` fact.
 */
type BodyEnd = StepEnd & {
  readonly problems: readonly string[];
  readonly failed?: readonly string[];
  /** The green checks the step trusted in place of a run of its own: the mutation step's skip. */
  readonly trusted?: Checked;
  /** Why a test writer's run on the base could not run, for the step's `ended` fact (tracker 193). */
  readonly failure?: Failure;
};

type Failure = NonNullable<FactOf<"ended">["failure"]>;

/** A test writer's end, with the cause its run on the base gave, if it gave one. Pure. */
const withFailure = (end: BodyEnd, failure: RunFailure | null): BodyEnd => {
  if (failure === null) {
    return end;
  }

  const { why, code, ms, tail } = failure;
  return { ...end, failure: { why, code, ms, tail } };
};

const ended = (
  outcome: Parameters<typeof factOutcome>[0],
  carry: StepEnd["carry"] = {},
  problems: readonly string[] = [],
): BodyEnd => ({
  outcome: factOutcome(outcome),
  carry,
  problems,
});

/** A question a person decides, with the step's end kept for a `go_on`. `found`: what they read before it. */
const asksFirst = (about: "decision" | "no_change", end: BodyEnd, found: readonly string[]): BodyEnd => ({
  outcome: factOutcome({ kind: "ask", who: "owner", for: about }),
  after: end.outcome,
  carry: end.carry,
  problems: found,
});

/**
 * What a builder says it could not do and which of its own checks it saw fail, for the ticket. Neither
 * decides anything: the code's own checks judge the change. `null`: nothing to say. Pure.
 */
const builderSaid = (built: Built | null): string | null => {
  const left = built?.left ?? [];
  const failedRuns = (built?.ran ?? []).filter((r) => !r.passed).map((r) => `\`${r.command}\``);

  if (left.length === 0 && failedRuns.length === 0) {
    return null;
  }

  return inert(
    [
      "From the builder's own form. This decides nothing: the code's checks judge the change.",
      ...(left.length === 0 ? [] : ["", "What it could not do:", listed(left)]),
      ...(failedRuns.length === 0 ? [] : ["", "Checks it saw fail:", listed(failedRuns)]),
    ].join("\n"),
  );
};

const propertiesOf = (carry: Carry, round: number) => {
  if (round > 1) {
    return carry.open.map((item, i) => ({
      id: `p${i + 1}` as PropertyId,
      when: item.text,
      result: item.wants.join(" ") || item.says,
      why: item.says,
      behavior: "new" as const,
      tool: "test" as const,
      code: [],
    }));
  }

  return (carry.plan?.properties ?? []).map((p, i) => ({ ...p, id: `p${i + 1}` as PropertyId }));
};

/**
 * Code's own `[build] checks` at `head`, after a build (self-fix PR 4), and what the ticket keeps of
 * them: the `checked` fact, and on red, a comment with each failing test by name and the first lines
 * of why. Both exist only now. The carry gets `checked`; the run's own words come back beside it.
 * `at.run`: the ids the facts go under, a step's run or a restart's fresh read of main. `pr`: the pull
 * request whose head it is, when that is not the lane's own (the exam's).
 */
const recordChecks = (at: Pick<At, "run"> & { readonly cmd: { readonly number: number } }, head: string, pr?: string) =>
  Effect.gen(function* () {
    const tickets = yield* Tickets;
    const ran = yield* (yield* CheckRunner).run(head);
    const checked: Checked = {
      head: ran.head,
      commands: ran.commands,
      result: ran.result,
      failed: ran.failed.slice(0, FAILED_MOST),
    };
    yield* tickets.write(at.cmd.number, `${at.run}/checked`, {
      type: "checked",
      ...checked,
      ...(pr === undefined ? {} : { pr }),
    });

    if (ran.result === "red") {
      yield* tickets
        .talk(at.cmd.number, `${at.run}/red`, {
          type: "commented",
          body: saidOf(redWords(ran.failed, ran.tail, FAILED_MOST)),
        })
        .pipe(Effect.ignore);
    }

    return { checked, ran };
  });

/** Why the checks could not run at a head, in words for the ticket. Pure. */
const notRunWords = (head: string, tail: string) =>
  `The checks could not run at ${head}, so nothing says whether this work holds.${tail === "" ? "" : ` ${inert(tail)}`}`;

/**
 * Code's checks at `head`, for the carry: on red, each failing test is open too, so the builder the
 * red goes back to is told them by name (self-fix PR 3).
 */
const checkedWithRed = (at: At, head: string) =>
  Effect.gen(function* () {
    const { checked, ran } = yield* recordChecks(at, head);
    const carry =
      checked.result === "red" ? { checked, open: withRed(at.cmd.carry.open, ran.failed, ran.tail) } : { checked };
    return { checked, ran, carry };
  });

/**
 * A later round whose builder changed nothing, by what code's checks say at the head.
 *
 *   green         go_on or stop: the work stands, and the mutation step still has to pass
 *   red           again or stop, or the lane ends once its rounds are spent: a go_on could not land
 *   could not run the lane ends stuck: it never guesses green
 */
/**
 * A later round the builder changed nothing in, by code's checks at its head. `moved`: code changed
 * the test writer's files under the builder since its last round, so a green head is the work done,
 * with nothing to ask.
 */
const nothingChanged = (at: At, kept: StepEnd["carry"], says: string, moved: boolean) =>
  Effect.gen(function* () {
    const { round } = at.cmd;
    const head = yield* need(kept.head, "no head to run the checks at");
    const { checked, ran, carry: checks } = yield* checkedWithRed(at, head);
    const carry = { ...kept, ...checks };

    if (checked.result === "not_run") {
      return ended({ kind: "stuck", why: "checks_not_run" }, carry, [
        `The builder changed nothing. ${notRunWords(head, ran.tail)} ${says}`,
      ]);
    }

    if (checked.result === "green") {
      return moved
        ? ended({ kind: "done", part: false }, carry, [says])
        : asksFirst("no_change", ended({ kind: "done", part: false }, carry), [says]);
    }

    if (round >= MAX_ROUNDS) {
      return ended({ kind: "stuck", why: "rounds_spent" }, carry, [
        `The builder changed nothing in round ${round} of ${MAX_ROUNDS}, and the new test is still failing. ${says}`,
      ]);
    }

    return ended({ kind: "ask", who: "owner", for: "still_red" }, carry, [says]);
  });

/**
 * A build that ended well, by what code's checks say at its head: the builder's own form decides
 * nothing (docs/direction/nobody-grades-their-own-work.md).
 *
 *   green         done, and the head's checks go with it to every step after
 *   red           back to the builder, a round up, with each failing test open
 *   could not run the lane stops: never done
 */
const builtAndChecked = (at: At, built: BodyEnd) =>
  Effect.gen(function* () {
    const head = yield* need(built.carry.head, "no head to run the checks at");
    const { checked, ran, carry: checks } = yield* checkedWithRed(at, head);
    const carry = { ...built.carry, ...checks };

    switch (checked.result) {
      case "green":
        return { ...built, carry };
      case "red":
        return {
          ...ended({ kind: "send", to: "builder", why: "checks_red" }, carry, built.problems),
          failed: checked.failed,
        };
      case "not_run":
        return ended({ kind: "stuck", why: "checks_not_run" }, carry, [...built.problems, notRunWords(head, ran.tail)]);
    }
  });

/**
 * A tests command as an agent runs it by hand: without the JSON report `{out}` asks for, which only
 * code reads. With it, the agent would see no output and write a file named `{out}`. Pure.
 */
const byHand = (command: readonly string[]) =>
  command.filter((word) => !word.includes("{out}") && word !== "--reporter=json");

/** Each step: what its agent is told, and its machine, to its end. */
const bodies = {
  triage: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      yield* at.tell(yield* work.empty, "read", {});
      const end = yield* sortToTheEnd(
        at.stages.triage,
        at.cmd.intent,
        { ticket: at.url, tries: 3 },
        { ...budgetOf(at), note: `A ticket on ${at.repo}.` },
      );
      return ended(end.outcome, {}, end.report.problems);
    }),

  plan: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const tickets = yield* Tickets;
      const main = yield* work.main;
      // A plan written again after a person's `no` (self-fix PR 5): what they wrote beside it binds it.
      const said = at.cmd.carry.decided?.said ?? [];
      yield* at.tell(yield* work.copy(main), "read", {
        ticket: ticketWords(at),
        base: main,
        code_context: "None gathered. Read the code in your folder.",
        names: "None gathered.",
        decisions:
          said.length === 0
            ? "None."
            : ["A person said no to the last plan, and wrote this beside their answer:", listed(said)].join("\n"),
        note: "",
      });
      const end = yield* planToTheEnd(
        at.cmd.intent,
        { ticket: at.url, tries: 3 },
        budgetOf(at),
        at.stages.plan as never,
      );
      const draft = end.report.plan;

      // A plan out of tries still reports its last draft: it failed its Check, so it is kept nowhere.
      if (draft === null || end.outcome.kind === "stuck") {
        return ended(end.outcome, {}, end.report.problems);
      }

      const data = revisionOfDraft(draft);

      if (data === null) {
        return ended({ kind: "stuck", why: "unchecked" }, {}, [
          "The plan passed its check and still could not be kept as a plan, so nothing was written down. This is a fault in the lane, not in the plan: its check and its form disagree.",
        ]);
      }

      const plan = planOf(at.id);
      yield* sendFact(
        { type: "planned", plan, tickets: [ticketOf(plan)], data, problems: [] },
        { id: `${at.run}/planned`, by: "lane" },
      );
      const track = foldLedger(yield* readFacts).plans.get(plan);
      const version = track?.versions.length ?? 1;
      const last = track?.versions.at(-1);
      const tasks = (last?.data.tasks ?? []).map((t) => t.id);
      yield* tickets.write(at.cmd.number, `${at.run}/planned-fact`, {
        type: "planned",
        version,
        tasks,
      });

      if (last !== undefined) {
        const view = planMarkdown(last.data, at.title, draft.exam ?? []);
        yield* tickets.talk(at.cmd.number, `${at.run}/plan-text`, {
          type: "commented",
          body: saidOf(view),
        });

        // A long plan is cut, and its open questions come last: a person's yes takes their leans.
        if (saidOf(view) !== view && last.data.questions.length > 0) {
          yield* tickets.talk(at.cmd.number, `${at.run}/plan-questions`, {
            type: "commented",
            body: saidOf(
              ["The plan above is too long to show whole. Its open questions:", ...questionLines(last.data)].join("\n"),
            ),
          });
        }
      }

      return ended(end.outcome, {
        plan: draft,
        version,
        rules: (draft.exam ?? []).map((c) => c.path),
        decided: { questions: last?.data.questions ?? [], said: [] },
      });
    }),

  exam: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const main = yield* work.main;
      const changes = at.cmd.carry.plan?.exam ?? [];
      // A redo (self-fix PR 10): the pull request was sent back, so the writer starts at its head,
      // or on main when main does not merge into that head.
      const pull = at.cmd.carry.examPull;
      const redo =
        pull?.why === undefined || at.cmd.carry.examPr === null
          ? undefined
          : { head: pull.head, why: pull.why, ...(pull.on === undefined ? {} : { on: pull.on }) };
      // A redo on main is pushed over the exam branch (the owner's pick on PR 322). The push keeps
      // what it replaces, as the remote holds it then, and says so on the ticket (./work.ts, `pushBranch`).
      const base = redo === undefined || redo.on === "main" ? main : redo.head;
      yield* at.tell(yield* work.copy(base), "read", {
        ticket: `${at.title}\n\n${at.body}`,
        changes: listed(changes.map((c) => `${c.path}: ${c.change} (${c.why})`)),
        sent_back: listed(redo?.why ?? []),
        folder: folderWords(redo),
        note: "",
      });
      const end = yield* examToTheEnd(at.stages.exam, at.cmd.intent, {
        ticket: at.url,
        number: at.cmd.number,
        base,
        changes,
        tries: 3,
        ...(redo === undefined ? {} : { redo }),
      });
      const { head } = end.report;
      return ended(
        end.outcome,
        { examPr: end.report.pr ?? null, ...(head === null ? {} : { examPull: { head } }) },
        end.outcome.kind === "ask"
          ? ["These rule changes are in a pull request of their own:", ...ruleChangeLines(changes)]
          : end.report.problems,
      );
    }),

  exam_review: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const tickets = yield* Tickets;
      const { carry } = at.cmd;
      const pr = yield* need(carry.examPr, "the exam has no pull request");
      const back = (why: readonly string[], head: string, on?: RedoOn) => ({
        examPull: { head, why, ...(on === undefined ? {} : { on }) },
      });
      const ready = yield* examReady(at.cmd.number, pr, carry.rules);

      if (ready._tag === "moved") {
        return ended({ kind: "stuck", why: "head_moved" }, {}, [
          `The rule changes' branch on the code host is at ${ready.theirs}, which does not follow ${ready.ours}, where the lane left it. Someone rewrote it, so the lane does not guess which stands.`,
        ]);
      }

      if (ready._tag === "conflicts") {
        return ended(
          { kind: "send", to: "builder", why: "conflicts" },
          back(
            ready.files.map((file) => `\`${file}\` conflicts with main: write it again on main.`),
            ready.head,
            "main",
          ),
          [`Main does not merge into the rule changes: ${ready.files.join(", ")}.`],
        );
      }

      const { head } = ready;
      const { checked, ran } = yield* recordChecks(at, head, pr);

      if (checked.result === "not_run") {
        return ended({ kind: "stuck", why: "checks_not_run" }, { examPull: { head } }, [notRunWords(head, ran.tail)]);
      }

      if (checked.result === "red") {
        return {
          ...ended(
            { kind: "send", to: "builder", why: "checks_red" },
            back(
              checked.failed.map((name) => `This check fails: ${name}`),
              head,
            ),
            [`The checks fail on the rule changes at ${head}.`],
          ),
          failed: checked.failed,
        };
      }

      yield* at.tell(yield* work.judgeCopy(head), "read", {
        body: ticketWords(at),
        tools: [
          "This review is of the rule changes' own pull request: the plan lists them, and they land before any of the ticket's own work. Judge each criterion below against them.",
          "A shell, in a read-only copy of the code at this head: your box refuses a write there.",
        ].join("\n\n"),
        checked: "The checks below ran at this head.",
        decided: "None.",
      });
      const target = examTarget(planOf(at.id));
      const reviewed: Reviewed = yield* Effect.gen(function* () {
        const rubrics = yield* work.rubrics(`${at.cmd.number}-${at.run}`);
        const runtime = yield* at.stages.review.get(at.cmd.intent).start(
          {
            type: "start",
            ask: { pr: target, head: null, rubrics, decisions: [] },
            settings: budgetOf(at),
          },
          { conflict: "use_existing" },
        );
        const end = yield* runtime.done();

        if (end.phase !== "over") {
          return yield* Effect.die(`the review stopped in ${end.phase}`);
        }

        yield* keepRows(end.report, target);
        return { pr: target, outcome: end.outcome, name: nameOf(end.outcome), ...end.report };
      }).pipe(Effect.scoped);
      const open = reviewed.criteria.filter((c) => c.state === "open");
      const met = reviewed.criteria.length - open.length;
      const of = reviewed.criteria.length;
      // What it read, at the side tree's head, only known now: what a yes on it is given on (./carry.ts).
      const given = yield* work.given(head, "main");
      yield* tickets.write(at.cmd.number, `${at.run}/reviewed`, {
        type: "reviewed",
        head,
        met,
        of,
        findings: open.map((c) => saidOf(c.text)),
        pr,
        onto: given.onto,
        base: given.base,
        diff: given.diff,
      });
      // Posted on the exam's pull request at that head, as the push step posts the lane's own.
      const posts = postsOf(reviewed);
      yield* (yield* PullWire).post(pr, head, posts);
      yield* (yield* LanePulls).post(
        pr,
        head,
        posts.map((p) => ({ kind: p.kind, verdict: p.verdict })),
      );

      if (reviewed.outcome.kind !== "done") {
        return ended(
          reviewed.outcome,
          reviewed.outcome.kind === "send" ? back(sentBack(reviewed), head) : { examPull: { head } },
          reviewed.problems,
        );
      }

      // A person's earlier `merge` stands here only if what they saw carries to this head.
      const yes = carry.examPull?.yes;
      const kept = yes !== undefined && (yield* standsAt(at.cmd.number, yes, head));
      return ended(reviewed.outcome, {
        examPull: {
          head,
          reviewed: { ...given, met, of },
          ...(kept ? { yes: given } : {}),
        },
      });
    }),

  exam_merge: (at: At) =>
    Effect.gen(function* () {
      const pr = yield* need(at.cmd.carry.examPr, "the exam has no pull request");
      const outcome = yield* shipped(at, pr);
      const pull = at.cmd.carry.examPull;

      // Merged: the lane's branch moves onto main as it is now, so the test writer sees the exam it
      // was given (tracker 194). Here and not in the writer's body: a writer resumed after a kill
      // keeps the base it was asked on, and its base and its commit must agree.
      if (outcome.kind === "done") {
        const tip = yield* onNewMain(at.cmd);
        return ended(outcome, { base: tip, head: tip });
      }

      // A refusal the exam writer fixes goes to it with ship's words (./routes.ts). Main does not
      // merge into a head that conflicts, so that redo is written on main.
      return outcome.kind === "send" && pull !== undefined
        ? ended(outcome, {
            examPull: {
              ...pull,
              why: [`Ship refused the merge: ${nameOf(outcome)}.`],
              ...(outcome.why === "conflicts" ? { on: "main" as const } : {}),
            },
          })
        : ended(outcome);
    }),

  test_writer: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const settings = yield* work.settings;
      const { carry, round } = at.cmd;
      const tree = yield* work.tree(at.cmd.number);
      const redo = redoOf(carry);

      if (redo !== null) {
        return yield* writtenAgain(at, redo);
      }

      const base = yield* need(testsBase(carry, round, tree.base), "no head to add tests on");
      const properties = propertiesOf(carry, round);
      const includes = settings.test_writer?.includes ?? [...DEFAULT_INCLUDES];
      const taken = (yield* work.judgedFiles(base)).filter(includedBy(includes));
      const version = (carry.version ?? 1) + round - 1;
      const summary = carry.plan?.summary ?? at.title;
      const pointers = carry.plan?.pointers ?? [];
      // From the second round on, `base` is a head.
      yield* at.tell(yield* work.judgeCopy(base), "read", {
        ticket: ticketWords(at),
        plan: `Version ${version}. ${summary}`,
        jobs: jobsList(carry.plan),
        base,
        properties: fenced(JSON.stringify(properties, null, 1), "json"),
        interface: carry.plan?.interface === undefined ? "None." : fenced(carry.plan.interface, "ts"),
        pointers: listed(pointers.map((p) => `${p.at}: ${p.why}`)),
        includes: listed(includes),
        taken: listed(taken),
        test_command: (settings.test_writer?.run ?? []).join(" "),
        decided: decidedWords(carry),
        redo: "None.",
        note: "",
      });
      const end = yield* testsToTheEnd(at.stages.tests, at.cmd.intent, {
        ticket: at.url,
        plan: { version, summary },
        base,
        properties,
        pointers,
        includes,
        tries: 3,
      });
      const commit = end.report.commit;
      const files = commit === null ? [] : yield* work.filesOf(tree.tree, commit);
      const answers = end.report.written?.answers ?? [];
      const done = ended(
        end.outcome,
        {
          base: round > 1 ? carry.base : base,
          head: commit ?? base,
          exam: [...carry.exam, ...files],
          cannot: untestedRows(properties, answers),
          ...(commit === null ? {} : { wrote: { base, commit } }),
          // The first writing is the one under the build: a restart runs its check again on main.
          ...(round === 1 && commit !== null
            ? {
                written: {
                  commit,
                  tests: testsOf(answers).map(({ property, file, name }) => ({ property, file, name })),
                },
              }
            : {}),
        },
        [...end.report.problems, ...foundWords(properties, end.report.found, answers)],
      );
      return withFailure(done, end.report.failure);
    }),

  build: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const settings = yield* work.settings;
      const { carry, round } = at.cmd;
      const tree = yield* work.tree(at.cmd.number);
      // A person said the builder was wrong to change the test writer's files: they go back as it
      // wrote them, on top of the builder's work, and this round builds there (self-fix PR 5).
      const touched = carry.touched ?? [];
      const written = carry.written ?? null;
      const restored =
        touched.length === 0 || written === null || carry.head === null
          ? null
          : yield* work
              .reset(at.cmd.number, carry.head)
              .pipe(
                Effect.andThen(
                  work.putBack(at.cmd.number, written.commit, touched, "put the test writer's files back"),
                ),
              );
      // Before the builder's copy is read, so the round's base holds it and its diff never does.
      const formatted = yield* formatExam(at.cmd.number, tree.tree, carry.exam);
      const before = yield* work.head(tree.tree);
      const tests = propertiesOf(carry, round);
      const pointers = carry.plan?.pointers ?? [];
      const untested = carry.untested ?? [];

      // A person's go_on comes back here first, so it is on the ticket before anything is built on it.
      if (untested.length > 0) {
        yield* (yield* Tickets)
          .talk(at.cmd.number, `untested-${untested.length}`, {
            type: "commented",
            body: saidOf(untestedWords(untested).join("\n")),
          })
          .pipe(Effect.ignore);
      }

      yield* at.tell(tree.tree, "write", {
        summary: carry.plan?.summary ?? at.title,
        properties: fenced(JSON.stringify(tests, null, 1), "json"),
        tests: listed(carry.exam),
        interface: carry.plan?.interface === undefined ? "None." : fenced(carry.plan.interface, "ts"),
        pointers: listed(pointers.map((p) => `${p.at}: ${p.why}`)),
        exam: listed(carry.exam),
        checks: listed((settings.build?.checks ?? []).map((c) => byHand(c).join(" "))),
        quick: listed(
          (settings.mutation?.tests ?? []).length === 0 ? [] : [byHand(settings.mutation?.tests ?? []).join(" ")],
        ),
        decided: decidedWords(carry),
      });
      const end = yield* buildToTheEnd(
        at.cmd.intent,
        { ticket: at.url, number: at.cmd.number, round, open: carry.open },
        budgetOf(at) as never,
        at.stages.build as never,
      );
      const told = builderSaid(end.report.built);

      if (told !== null) {
        yield* (yield* Tickets).talk(at.cmd.number, `${at.run}/left`, {
          type: "commented",
          body: saidOf(told),
        });
      }

      const kept = {
        head: end.report.head ?? formatted ?? restored ?? carry.head,
        deviations: end.report.built?.deviations ?? [],
        left: end.report.built?.left ?? [],
        ...(touched.length === 0 ? {} : { touched: [] }),
      };

      // The builder changed the test writer's files: its work is held as a commit of its own, and a
      // person says which was wrong. Either way the build goes on from it.
      if (end.outcome.kind === "stuck" && end.outcome.why === "exam_touched") {
        const changed = yield* work.staged(tree.tree, before);
        const held = yield* work.commit(tree.tree, [], "the build's work, held: it changed the test writer's files");
        return ended(
          end.outcome,
          {
            ...kept,
            head: held,
            touched: examTouched(changed, carry.exam, (file) => ruleFiles([file]).length > 0),
          },
          end.report.problems,
        );
      }

      // A first round with no change has no work to go on with. A later one has the last round's,
      // and what can be asked about it depends on what the head's checks say now.
      if (round > 1 && end.outcome.kind === "stuck" && end.outcome.why === "no_change") {
        // A person's exam pick since the builder's last round changed the test writer's files under
        // it: the builder judged a head new to it.
        const { timeline } = yield* (yield* Tickets).read(at.cmd.number);
        return yield* nothingChanged(
          at,
          kept,
          `The builder says: ${inert(end.report.built?.summary ?? "nothing")}`,
          examPickedSinceBuild(timeline),
        );
      }

      const built = ended(end.outcome, kept, end.report.problems);
      return end.outcome.kind === "done" ? yield* builtAndChecked(at, built) : built;
    }),

  mutation: (at: At) =>
    Effect.gen(function* () {
      const { carry } = at.cmd;
      const base = yield* need(carry.base, "no base to mutate from");
      const head = yield* need(carry.head, "no head to mutate");
      const end = yield* mutationToTheEnd(at.stages.mutation, at.cmd.intent, {
        ticket: at.url,
        base,
        head,
        kept: (carry.plan?.properties ?? []).flatMap((p) => p.code ?? []),
        // The diff holds the writer's commit, so listing its files would always ask. The
        // builder's guard holds those files, and rule files land only by the exam's own pull request.
        exam: [],
        allowed: [],
        seed: at.cmd.count,
        most: MAX_MUTANTS,
        // Green at this head, it runs no suite of its own, and its end names them as trusted.
        ...(carry.checked === undefined ? {} : { checked: carry.checked }),
      });
      const survived = end.report.ran?.survived ?? [];
      const { trusted } = end.report;

      if (end.outcome.kind !== "send" || end.outcome.to !== "builder") {
        return { ...ended(end.outcome, { survived }), ...(trusted === undefined ? {} : { trusted }) };
      }

      // A red head: the names and the first lines of why exist only now, so the ticket keeps them.
      const { failed = [], tail = "" } = end.report;
      yield* (yield* Tickets)
        .talk(at.cmd.number, `${at.run}/red`, {
          type: "commented",
          body: saidOf(redWords(failed, tail, FAILED_MOST)),
        })
        .pipe(Effect.ignore);
      return {
        ...ended(end.outcome, { survived, open: withRed(at.cmd.carry.open, failed, tail) }),
        failed: failed.slice(0, FAILED_MOST),
      };
    }),

  mutants: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const settings = yield* work.settings;
      const { carry } = at.cmd;
      const head = yield* need(carry.head, "no head the mutants lived on");
      const tree = yield* work.tree(at.cmd.number);
      const includes = settings.test_writer?.includes ?? [...DEFAULT_INCLUDES];
      const taken = (yield* work.judgedFiles(head)).filter(includedBy(includes));
      yield* at.tell(yield* work.judgeCopy(head), "read", {
        ticket: ticketWords(at),
        jobs: jobsList(carry.plan),
        head,
        survived: fenced(JSON.stringify(carry.survived, null, 1), "json"),
        properties: fenced(JSON.stringify(propertiesOf(carry, 1), null, 1), "json"),
        includes: listed(includes),
        taken: listed(taken),
        test_command: (settings.test_writer?.run ?? []).join(" "),
        decided: decidedWords(carry),
        note: "",
      });
      const end = yield* answersToTheEnd(at.stages.answers, at.cmd.intent, {
        ticket: at.url,
        head,
        survived: carry.survived,
        includes,
        tries: 3,
      });
      const commit = end.report.commit;
      // With no test written the commit is the head itself, and its files are the builder's: they
      // are not exam, or a later round could not change them.
      const files = commit === null || commit === head ? [] : yield* work.filesOf(tree.tree, commit);
      // The review comes next, with no build round before it to format these.
      const formatted = files.length === 0 ? null : yield* formatExam(at.cmd.number, tree.tree, files);
      const next = formatted ?? commit ?? head;
      // A new head needs green checks of its own before the review reads it: the build's were not at it.
      // Red there goes back to the builder, a round up, with each failing test open (./routes.ts).
      const checked = next === head ? {} : (yield* checkedWithRed(at, next)).carry;
      const answers = end.report.answered?.answers ?? [];
      return ended(
        end.outcome,
        {
          ...checked,
          head: next,
          exam: [...carry.exam, ...files],
          waiting: {
            findings: [],
            mutants: answers.flatMap((a) => (a.answer === "cannot" ? [{ mutant: a.mutant, why: a.why }] : [])),
          },
        },
        [...end.report.problems, ...mutantWords(answers)],
      );
    }),

  review: (at: At) =>
    Effect.gen(function* () {
      const work = yield* LaneWork;
      const tickets = yield* Tickets;
      const { carry } = at.cmd;
      const head = yield* need(carry.head, "no head to review");
      const folder = yield* work.judgeCopy(head);
      yield* at.tell(folder, "read", {
        body: ticketWords(at),
        tools: [
          "A shell, in a read-only copy of the code at this head: your box refuses a write there. Files an agent loads by itself, such as AGENTS.md, are main's here; the diff below shows any change to them.",
          "The repo's test runner may not start in this copy, since one such as Vitest writes a file as it starts. Do not spend your turn on that: code already ran the checks. To try one piece of the code by hand, run a short script with `node`.",
        ].join("\n\n"),
        checked: "The checks below ran at this head.",
        decided: decidedWords(carry),
      });
      const target = bookTarget(planOf(at.id));
      const reviewed: Reviewed = yield* Effect.gen(function* () {
        const rubrics = yield* work.rubrics(`${at.cmd.number}-${at.run}`);
        const runtime = yield* at.stages.review.get(at.cmd.intent).start(
          {
            type: "start",
            ask: {
              pr: target,
              head: null,
              rubrics,
              decisions: (carry.decided?.questions ?? []).map((q) => q.id),
            },
            settings: budgetOf(at),
          },
          { conflict: "use_existing" },
        );
        const end = yield* runtime.done();

        if (end.phase !== "over") {
          return yield* Effect.die(`the review stopped in ${end.phase}`);
        }

        yield* keepRows(end.report, target);
        return {
          pr: target,
          outcome: end.outcome,
          name: nameOf(end.outcome),
          ...end.report,
        } as Reviewed;
      }).pipe(Effect.scoped);
      const open = reviewed.criteria.filter((c) => c.state === "open");
      const counted = {
        title: at.title,
        met: reviewed.criteria.length - open.length,
        of: reviewed.criteria.length,
      };

      if (reviewed.head !== null) {
        yield* tickets.write(at.cmd.number, `${at.run}/reviewed`, {
          type: "reviewed",
          head: reviewed.head,
          met: counted.met,
          of: counted.of,
          findings: open.map((c) => saidOf(c.text)),
        });
      }

      const against = reviewed.against ?? [];

      // The review stage asks nobody, so it stops on what no one could see. A person can: the lane
      // asks one, with the reviewer's reason, as a step that ended on `ask`.
      if (reviewed.outcome.kind === "stuck" && reviewed.outcome.why === "unseen") {
        yield* tickets.talk(at.cmd.number, `${at.run}/unseen`, {
          type: "commented",
          body: saidOf(
            [
              "The review could not see all it needed, so it cannot say this holds:",
              listed(open.map((c) => inert(c.says))),
            ].join("\n"),
          ),
        });
      }

      const end =
        reviewed.outcome.kind === "stuck" && reviewed.outcome.why === "unseen"
          ? ended({ kind: "ask", who: "owner", for: "unseen" }, { reviewed: counted })
          : ended(
              reviewed.outcome,
              {
                reviewed: counted,
                posts: postsOf(reviewed),
                open: reviewed.outcome.kind === "send" ? openItems(reviewed) : [],
              },
              reviewed.problems,
            );

      // A finding against a decision is no fault of the work: the person says which stands, right
      // here, and the review's own end, an ordinary finding's round too, waits on their answer.
      if (against.length === 0) {
        return end;
      }

      const waiting = {
        findings: against.map(({ id, fault }) => ({ id, fault })),
        mutants: [],
      };
      return asksFirst("decision", { ...end, carry: { ...end.carry, waiting } }, againstWords(carry, against));
    }),

  push: (at: At) =>
    Effect.gen(function* () {
      const { carry } = at.cmd;
      const base = yield* need(carry.base, "no base to push from");
      const head = yield* need(carry.head, "no head to push");
      const ticket = { url: at.url, number: at.cmd.number, title: at.title };
      const outcome = yield* pushedBy(at.stages.push, at.cmd.intent, `${at.run}/pushed`, {
        ask: pushAsk(ticket, head, carry),
        base,
      });
      return outcome.kind === "done" ? ended(outcome, { pr: outcome.pr }) : ended(outcome);
    }),

  merge: (at: At) =>
    Effect.gen(function* () {
      const pr = yield* need(at.cmd.carry.pr, "no pull request to merge");
      const head = yield* need(at.cmd.carry.head, "no head to merge");
      const outcome = yield* shipped(at, pr);

      if (outcome.kind === "send") {
        return ended(outcome, yield* theirsTakenIn(at, head));
      }

      if (outcome.kind !== "done") {
        return ended(outcome);
      }

      const watch = yield* LaneWatch;

      if (outcome.cleanup !== "not_run") {
        yield* watch.merged(at.cmd.number, pr, head);
        return ended(outcome);
      }

      // Ship found it merged, and its `commit` is the head the host read. That is this lane's own merge
      // whose answer was lost, or a person's. So the ticket shows what the host reads, and another head
      // than the one judged is no merge of this lane's.
      yield* watch.look(at.cmd.number, pr);
      return outcome.commit === head
        ? ended(outcome)
        : ended({ kind: "stuck", why: "merged_elsewhere" }, {}, [
            `${pr} was merged at ${outcome.commit}, by someone other than this lane. This lane judged ${head}.`,
          ]);
    }),
};

/**
 * The lane's branch as the code host has it now, taken in when a person moved it on from `head`
 * (jidoka rows 62 and 63): the step ship's send goes to works from their commit, and the next push
 * keeps it. Only a fast-forward is taken in. A rewritten branch stays at `head`, and the next push
 * keeps theirs under a kept ref (`LaneWork.pushTo`). Code's checks run at the head taken in, as after
 * a build, since every step after build needs them there.
 */
const theirsTakenIn = (at: At, head: string) =>
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const { branch } = yield* work.tree(at.cmd.number);
    const theirs = yield* work.remoteHead(branch);

    if (theirs === null || theirs === head || (yield* work.mergeBase(head, theirs)) !== head) {
      return {};
    }

    yield* work.reset(at.cmd.number, theirs);
    return { head: theirs, ...(yield* checkedWithRed(at, theirs)).carry };
  });

/** Ship, as it is, to its end. Its guards are its own. */
const shipped = (at: At, pr: string) =>
  Effect.gen(function* () {
    const runtime = yield* at.stages.ship.get(at.cmd.intent).start({ type: "start", pr }, { conflict: "use_existing" });
    const end = yield* runtime.done();

    if (end.phase !== "over") {
      return yield* Effect.die(`the ship stopped in ${end.phase}`);
    }

    return end.outcome;
  }).pipe(Effect.scoped);

const laneInterpret = ({ send, machines }: Stages) => ({
  lane_read: (cmd: ReturnType<typeof readFiled>) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets;
      const { person } = yield* LaneHome;
      const ticket = yield* tickets.read(cmd.number);
      return {
        state: ticket.state === "closed" ? ("closed" as const) : ("open" as const),
        mine: filedBy(ticket.timeline[0]?.by, person),
      };
    }).pipe(Effect.mapError(() => unknown)),

  lane_claim: (cmd: ReturnType<typeof claimLane>) =>
    Effect.gen(function* () {
      const { repo } = yield* (yield* LaneWork).origin;
      return yield* claim(`${repo}#${cmd.number}` as TicketId, cmd.lane);
    }).pipe(Effect.mapError(() => unknown)),

  lane_release: (cmd: ReturnType<typeof releaseLane>) =>
    Effect.gen(function* () {
      // First: it never fails, and a kill before the release comes back here to finish both.
      yield* leaveBehind(cmd.number, cmd.outcome);
      const { repo } = yield* (yield* LaneWork).origin;
      yield* release(`${repo}#${cmd.number}` as TicketId, cmd.lane);
      return "released" as const;
    }).pipe(Effect.mapError(() => unknown)),

  lane_ask: (cmd: ReturnType<typeof askPerson>) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets;
      const spent =
        cmd.spent === true
          ? [
              yield* tickets.read(cmd.number).pipe(
                Effect.map((ticket) => spentWords(factsOf(ticket.timeline, "ended"))),
                Effect.orElseSucceed(() => "What the runs on this ticket have cost could not be read: price unknown."),
              ),
            ]
          : [];

      // Before the question, so a person who sees it finds this already there.
      if ((cmd.does ?? []).length > 0) {
        yield* tickets
          .talk(cmd.number, `${cmd.ask}/picks`, {
            type: "commented",
            body: saidOf([...(cmd.also ?? []), ...spent, "What each answer does:", listed(cmd.does ?? [])].join("\n")),
          })
          .pipe(Effect.ignore);
      }

      // The lane that asks, by the trace id its `started` facts carry, so a view of a ticket with
      // several lanes puts the ask in the right one.
      const trace = yield* jobTraceId;
      yield* tickets.write(cmd.number, cmd.ask, {
        type: "asked",
        ask: cmd.ask,
        what: cmd.what,
        ...(cmd.head === undefined ? {} : { head: cmd.head }),
        picks: cmd.picks as never,
        ...(trace === null ? {} : { trace }),
      });
      yield* send("step", `asks: ${cmd.what} Answer it in: ticket --ticket ${cmd.number}`);
      return null;
    }).pipe(Effect.mapError(() => unknown)),

  // A fresh read of main, a restart's (self-fix PR 5) or a route's (PR 11): the ticket first, then
  // main, then the lane's branch put on it (`putOnMain`). The ticket's row says from where, main then
  // and now, and what changed. A route's read pushes a merged head with green checks (`pushedIfRouted`).
  lane_fresh: (cmd: ReturnType<typeof freshMain>) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets;
      const work = yield* LaneWork;
      const { person } = yield* LaneHome;
      yield* work.servingLane(cmd.number);
      const ticket = yield* tickets.read(cmd.number);

      if (ticket.state === "closed") {
        return { _tag: "closed" } as const;
      }

      if (!filedBy(ticket.timeline[0]?.by, person)) {
        return { _tag: "not_yours" } as const;
      }

      const onto = yield* work.main;
      const put = startsOver(cmd.from, cmd.round) ? yield* startOver(cmd, onto) : yield* putOnMain(cmd, onto);
      const { found } = put;
      const head = cmd.carry.head;
      const to = found.carry?.head ?? head;
      yield* tickets.write(cmd.number, cmd.intent, {
        type: "restarted",
        from: cmd.from.step,
        base: cmd.carry.base,
        onto,
        head,
        to,
        conflicts: put.conflicts,
        ...(put.kept === undefined ? {} : { kept: put.kept }),
      });

      if (found._tag === "conflicts" || found._tag === "exam_conflict") {
        return found;
      }

      // A step after the build runs only on green checks at its head: code runs them now, if the head
      // has none, so a red one goes back to the builder and one that could not run stops the lane.
      const checked = found.carry.checked ?? cmd.carry.checked;
      const green = checked !== undefined && checked.head === to && checked.result === "green";

      if (!afterBuild(cmd.from.step) || to === null || green) {
        return yield* pushedIfRouted(machines.push, cmd, ticket, found, green);
      }

      const ran = yield* recordChecks({ run: cmd.intent, cmd }, to);
      const red =
        ran.checked.result === "red"
          ? { open: withRed(found.carry.open ?? cmd.carry.open, ran.ran.failed, ran.ran.tail) }
          : {};
      const read = { ...found, carry: { ...found.carry, checked: ran.checked, ...red } };
      return yield* pushedIfRouted(machines.push, cmd, ticket, read, ran.checked.result === "green");
    }).pipe(Effect.mapError(() => unknown)),

  lane_step: (cmd: Carried) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets;
      const work = yield* LaneWork;
      const now = yield* LaneNow;
      const home = yield* LaneHome;
      yield* work.servingLane(cmd.number);
      const run = `r-${cmd.step}-${cmd.count}`;
      // "run a step" says its run and step as it begins too, so a log reading its span can say
      // the step began (apps/fabrika, host/log.ts); its end tags them again, with its outcome.
      yield* Effect.annotateCurrentSpan({ [LANE.run]: run, [LANE.step]: cmd.step });
      const from = yield* Clock.currentTimeMillis;
      const said = (line: string) => send("step", `${cmd.step}: ${line}`);
      const seen = yield* Ref.make<Picked | null>(null);
      const keying = yield* Ref.make<{ readonly key: Hash; readonly inputs: Inputs } | null>(null);

      const body = Effect.gen(function* () {
        const { repo } = yield* work.origin;
        const url = ticketUrlOf(repo, cmd.number);
        const id = yield* need(readTicketId(url), `${url} names no ticket`);
        const settings = yield* work.settings;
        const agent = AGENT_STEPS[cmd.step];
        const picked = agent === undefined ? null : pickedFor(settings, agent.step);
        // Kept outside the body, so its end prices the run by its model even when it broke.
        yield* Ref.set(seen, picked);
        const brief = agent === undefined ? null : yield* loadBrief(home.briefs, agent.brief);
        const ticket = yield* tickets.read(cmd.number);
        const first = ticket.timeline[0]?.fact;
        // What the step reads, as its input key (P7): only known now. The end keeps the inputs too, the
        // same value the key is made of, so a later reader can say which one changed.
        const inputs: Inputs = {
          step: cmd.step,
          ticket: yield* hashOf(textOf(ticket)),
          plan: cmd.carry.version,
          base: cmd.carry.base,
          exam: examHeadOf(ticket.timeline),
          head: cmd.carry.head,
          brief: brief?.hash ?? null,
          harness: picked?.harness ?? null,
          model: picked?.model ?? null,
          effort: picked?.effort ?? null,
          settings: yield* sha256(JSON.stringify(settings)),
        };
        yield* Ref.set(keying, { key: yield* keyOf(inputs), inputs });
        yield* now.exam.set(cmd.carry.exam);
        const trace = yield* jobTraceId;
        // Before any setup: the ticket shows the step running, and a crash leaves `started` behind.
        // Its agent's session id comes as a fact of its own, when the session opens.
        yield* stepStarted(cmd.number, {
          type: "started",
          run,
          stage: cmd.step,
          task: null,
          log: null,
          round: cmd.round,
          ...(trace === null ? {} : { trace }),
          ...(brief === null ? {} : { brief: brief.name, hash: brief.hash }),
          ...(picked === null ? {} : { harness: picked.harness, model: picked.model, effort: picked.effort }),
        });
        const at: At = {
          cmd,
          repo,
          url,
          id,
          run,
          picked,
          brief,
          title: ticket.title,
          body: first?.type === "filed" ? first.body : "",
          stages: machines,
          tell: (folder, access, slots) =>
            brief === null || picked === null ? Effect.void : now.set({ picked, brief, slots, folder, access }),
        };
        return yield* bodies[cmd.step](at) as Effect.Effect<BodyEnd, Broke>;
      }).pipe(Effect.scoped);

      const exit = yield* Effect.exit(body);
      // The session id a write could not land when it opened, written now, so it is never lost.
      const sessionLeft = now.session.left;
      const spent = yield* now.take;
      // Who ran it, even when the step broke after it was picked: a price is never guessed as free.
      const picked = yield* Ref.get(seen);
      const { usd, listUsd } = priceOf(picked, spent);
      const to = yield* Clock.currentTimeMillis;
      const keyed = yield* Ref.get(keying);
      // `carry`: what the step left, the change the lane lays on its carry, for the fold (./restart.ts).
      const write = (outcome: Outcome, more: Pick<BodyEnd, "carry" | "failed" | "trusted" | "failure">) =>
        tickets.write(cmd.number, `${run}/ended`, {
          type: "ended",
          run,
          stage: cmd.step,
          outcome,
          usd,
          input: spent.input,
          output: spent.output,
          turns: spent.turns,
          misfits: spent.misfits,
          cached: spent.cached,
          billed: spent.usd,
          listUsd,
          minutes: (to - from) / 60_000,
          ...(picked === null ? {} : { harness: picked.harness, model: picked.model, effort: picked.effort }),
          ...(more.failed === undefined ? {} : { failed: more.failed }),
          ...(more.trusted === undefined ? {} : { trusted: more.trusted }),
          ...(more.failure === undefined ? {} : { failure: more.failure }),
          ...(keyed === null ? {} : keyed),
          carry: more.carry,
        } as CodeFact);
      // "run a step" ends tagged with what its `ended` says, so its spans tie to the run without
      // matching times. Dollars only when known: a list price, else what claude billed.
      const tagged = (outcome: Outcome) =>
        Effect.annotateCurrentSpan(
          stepTags({
            run,
            step: cmd.step,
            outcome: nameOf(outcome),
            agent:
              picked === null
                ? null
                : {
                    model: picked.model,
                    input: spent.input,
                    cached: spent.cached,
                    output: spent.output,
                  },
            usd: listUsd ?? (picked?.harness === "claude" ? spent.usd : null),
          }),
        );

      if (Exit.isSuccess(exit)) {
        const { outcome, carry, problems, after: past } = exit.value;
        yield* sessionLeft.pipe(Effect.ignore);
        yield* write(outcome, exit.value);
        yield* tagged(outcome);
        yield* said(
          [
            nameOf(outcome),
            ...(picked === null ? [] : [`${picked.model}, ${spent.input + spent.output} tokens, ${money(listUsd)}`]),
          ].join("  "),
        );
        // A stuck the lane ends on says so. What comes before a question says what the step found,
        // where the question can point at it.
        const talk = endTalk(cmd.step, outcome, cmd.round, problems);

        if (talk?.kind === "stuck") {
          yield* said(`why: ${problems.join(" ").slice(0, 2_000)}`);
        }

        if (talk !== null) {
          yield* tickets
            .talk(cmd.number, `${run}/${talk.kind === "stuck" ? "why" : "found"}`, {
              type: "commented",
              body: saidOf(talk.body),
            })
            .pipe(Effect.ignore);
        }

        return { outcome, carry, ...(past === undefined ? {} : { after: past }) };
      }

      // A named end: the fact says it broke, and the line says what a person can do.
      const stops = String(exit.cause).slice(0, 300);
      yield* sessionLeft.pipe(Effect.ignore);
      const broke = factOutcome({ kind: "stuck", why: "run_failed" });
      yield* write(broke, { carry: {} }).pipe(Effect.ignore);
      yield* tagged(broke);
      yield* said(`could not run: ${stops}`);
      return yield* Effect.fail(unknown);
    }).pipe(Effect.mapError(() => unknown)),
});

const laneKind = kind({
  machine: lane,
  state: Lane,
  parent: "main",
  options: (stages: Stages) => ({
    ctx: undefined,
    interpret: laneInterpret(stages),
    subscribe: {
      lane_answer: (sub: { readonly deps: AnswerWait }) =>
        // The wait's span ends tagged with the ask, what it was for, the pick and who picked: the
        // stream runs inside it. The note is a value a person typed, so it stays off.
        answerHeard(sub.deps.number, sub.deps.ask, sub.deps.picks).pipe(
          Stream.tap((heard) => Effect.annotateCurrentSpan(answerTags({ ...heard, for: sub.deps.for }))),
          Stream.map((heard) => ({ type: "lane_answered" as const, ...heard })),
        ),
    },
    terminal: (s: Lane) => s.phase === "over",
  }),
  recovered: (s) => (s.phase === "idle" ? null : { type: "resume" }),
  drawing: ({ id }) => ({
    name: id,
    service: "lane",
    steps: {
      lane_read: "read the ticket",
      lane_claim: "claim it",
      lane_step: "run a step",
      lane_ask: "ask the person",
      lane_fresh: "read main fresh",
      lane_answer: "wait for the answer",
      lane_release: "let it go",
    },
  }),
  status: (s) =>
    s.phase === "over"
      ? `#${s.number}: ${nameOf(s.outcome)}`
      : s.phase === "running"
        ? `#${s.number}: ${s.step}`
        : s.phase,
});

/** The one lane of one ticket. Started by `pipeline` under an id the ticket names. */
export const laneProgram = defineProgram({
  name: "lane",
  description: "One tracker ticket through every step, in order.",
  flags: { ticket: flag(TicketNumber, "The tracker ticket this lane works.") },
  inputs: {},
  outputs: OUTPUTS,
  machines: {
    lane: laneKind,
    triage: sortChild,
    plan: planChild,
    exam: examChild,
    tests: testsChild,
    answers: answersChild,
    build: buildChild,
    mutation: mutationChild,
    review: reviewChild,
    push: pushChild,
    ship: shipChild,
  },
  main: ({ flags, send, machines }) =>
    Effect.gen(function* () {
      const n = flags.ticket;
      const origin = yield* Effect.result((yield* LaneWork).origin);

      if (origin._tag === "Failure") {
        const says = origin.failure.says ?? "the checkout's origin could not be read";
        yield* send("ended", { name: "stuck:step_failed", said: says });
        return;
      }

      const id = readTicketId(`${origin.success.repo}#${n}`);

      if (id === null) {
        yield* send("ended", {
          name: "stuck:step_failed",
          said: `${origin.success.repo} names no repo`,
        });
        return;
      }

      const ref = machines.lane.get(`lane/${n}`);
      const kept = yield* ref.read;
      const laneId =
        kept === null || kept.phase === "idle"
          ? yield* newLane(id)
          : "lane" in kept
            ? kept.lane
            : "held" in kept
              ? kept.held.lane
              : yield* newLane(id);
      // Copied into the lane as it starts: a machine decides with it, so a later edit cannot change a run.
      const settings = yield* Effect.result((yield* LaneWork).settings);
      const sendBack = settings._tag === "Success" ? (settings.success.build?.send_back ?? true) : true;
      const runtime = yield* ref.start(
        { type: "start", number: n, lane: laneId, sendBack },
        { conflict: "use_existing" },
      );

      // The same line typed again on a lane that stopped (self-fix PR 5): a kept run that is over gets
      // no first Msg, so the restart goes to it here. A stop saved before it kept a `Held` goes on from
      // the fold of the ticket's facts, under the lane this line named.
      if (kept?.phase === "over" && !isEnd(kept.outcome)) {
        // A save with no `Held` goes on from its ticket's facts: one that cannot be read stops the lane,
        // never folds from nothing.
        const seen = "held" in kept ? null : yield* Effect.result(seenOf(n));

        if (seen?._tag === "Failure") {
          yield* send("ended", {
            name: "stuck:step_failed",
            said: `the ticket could not be read to go on: ${seen.failure.says}`,
          });
          return;
        }

        const folded = seen === null ? null : fold(seen.success);
        const at = "at" in kept ? kept.at : folded?.at;
        const from = at === undefined ? "" : at._tag === "run" ? at.step : `${at.step}, asking ${at.for}`;
        yield* send("step", `restart: #${n} from ${from}, which ended ${nameOf(kept.outcome)} (${kept.said})`);
        yield* runtime
          .dispatch(folded === null ? { type: "restart" } : { type: "restart", folded, lane: laneId })
          .pipe(Effect.orDie);
      } else if (kept?.phase === "over" && kept.outcome.kind === "stuck" && FINAL.has(kept.outcome.why)) {
        yield* send("step", `restart: #${n} ended ${nameOf(kept.outcome)}, a person's call: ${kept.said}`);
      }

      const end = yield* runtime.done();

      if (end.phase !== "over") {
        return yield* Effect.die(`the lane stopped in ${end.phase}`);
      }

      yield* send("ended", { name: nameOf(end.outcome) as never, said: end.said });
    }).pipe(Effect.scoped),
});
