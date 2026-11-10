import type { Sub } from "@demlik/tea";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Sandbox } from "@kampus/fabrika-old";
import type { DraftRun } from "@kampus/fabrika-old/agents/claude";
import { layerOs } from "@kampus/fabrika-old/sandbox/os";
import { Clock, Duration, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { bookTarget } from "../../code-host-local.ts";
import { planOf, readTicketId } from "../../ids.ts";
import { CHECKS_WITHIN } from "../../settings.ts";
import { saidOf } from "../../tickets/ticket.ts";
import { Tickets } from "../../tickets/tickets.ts";
import { examTouched } from "../build/check.ts";
import { BuildWrites } from "../build/services.ts";
import { numberOf } from "../build/ticket.ts";
import { ExamWritten, ruleFiles } from "../exam/machine.ts";
import { ExamWork } from "../exam/program.ts";
import { MAX_MUTANTS } from "../mutation/machine.ts";
import { placeIn } from "../mutation/mutant.ts";
import { type Added, hashOf } from "../mutation/scope.ts";
import { MutationRunner, MutationScope } from "../mutation/services.ts";
import { strykerRunner } from "../mutation/stryker.ts";
import { PushWork } from "../push/program.ts";
import type { RunFailure, RunWhy } from "../test-writer/checked.ts";
import { Answered } from "../test-writer/mutants.ts";
import { TestsAgents, TestsWork } from "../test-writer/program.ts";
import { Report, resultsOf } from "../test-writer/results.ts";
import { includedBy, Written } from "../test-writer/written.ts";
import { draftRunner, LaneAgents, LaneNow } from "./agents.ts";
import { type CheckRun, CheckRunner, checkRunner, publicText, TAIL_LINES } from "./checks.ts";
import { examBook } from "./exam-pull.ts";
import { NO_FORMATTER } from "./format.ts";
import { ruleChangeLines } from "./found.ts";
import { LanePulls, PullWire } from "./pulls.ts";
import { LaneHome, LaneWork, pushBranch } from "./work.ts";

// The steps' own work, on this machine: what the test writer, the exam, the mutation step, the push
// and the build's writes do. Today's version. Each write finds its own first try, so an Act sent
// again after a kill does nothing twice.
//
// The rule that matters most is here: build's `push` commits nothing when the change touches a file
// the test writer wrote, or a rule file. It decides by what the agent's change really is, every
// commit of its own included, against the exact list of files the writer's own commits touched.

type Failed = { readonly _tag: "unknown" };
const failed: Failed = { _tag: "unknown" };
const couldNotRun = { _tag: "could_not_run" } as const;

/**
 * One file's `git diff --unified=0`, read for the lines it adds. The file's name comes from the
 * caller and only a hunk holds lines, so neither a name git quotes nor an added line that reads like
 * a header can mislead it. Pure.
 */
export const addedIn = (file: string, diff: string): readonly Added[] => {
  const out: Added[] = [];
  let line = 0;

  for (const text of diff.split("\n")) {
    if (text.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
    } else if (line > 0 && text.startsWith("+")) {
      out.push({ file, line: line++, text: text.slice(1) });
    }
  }

  return out;
};

/** Where `name` stands in a file: its first line, to the line before the next top-level one. Pure. */
export const spanIn = (file: string, text: string, name: string) => {
  const lines = text.split("\n");
  const from = lines.findIndex((l) => new RegExp(`\\b${name.replace(/\W/g, "\\$&")}\\b`).test(l));

  if (from < 0) {
    return [];
  }

  const rest = lines.slice(from + 1).findIndex((l) => /^\S/.test(l) && !/^[})\]]/.test(l));
  const to = rest < 0 ? lines.length : from + 1 + rest;
  return [{ file, from: from + 1, to }];
};

export const laneBuildWrites = Layer.effect(
  BuildWrites,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const now = yield* LaneNow;
    const tickets = yield* Tickets;
    return {
      copy: (_ticket, number) =>
        Effect.gen(function* () {
          const tree = yield* work.tree(number);
          return { tree: tree.tree, branch: tree.branch, base: yield* work.head(tree.tree) };
        }),
      push: (ticket, copied, message) =>
        Effect.gen(function* () {
          const changed = yield* work.staged(copied.tree, copied.base);
          const touched = examTouched(changed, yield* now.exam.get, (file) => ruleFiles([file]).length > 0);

          if (touched.length > 0) {
            yield* tickets
              .talk(numberOf(ticket), `exam-touched/${copied.base}`, {
                type: "commented",
                body: `The build changed the exam: ${touched.join(", ")}. Its work is held apart until a person says which was wrong.`,
              })
              .pipe(Effect.ignore);
            return yield* Effect.fail({ _tag: "exam_touched" as const });
          }

          // The builder's files through the repository's formatter, which leaves out the ones it took
          // away and any a link leads through. One that failed keeps what it wrote, and the ticket says
          // so: the checks still judge the change.
          const formatted = yield* work.format(copied.tree, changed);

          if (formatted._tag === "failed") {
            yield* tickets
              .talk(numberOf(ticket), `format-build-failed/${copied.base}`, {
                type: "commented",
                body: saidOf(
                  `The formatter failed on the builder's files, so what it could not format is kept as the builder wrote it. ${formatted.says}`,
                ),
              })
              .pipe(Effect.ignore);
          }

          const head = yield* work.commit(copied.tree, [], message);
          return { head, changed: head !== copied.base };
        }),
      // The change stays on this machine: the review reads the head, and the push step opens it.
      open: (ticket) => {
        const id = readTicketId(ticket);
        return id === null ? Effect.fail(failed) : Effect.succeed(bookTarget(planOf(id)));
      },
    };
  }),
);

/**
 * The test command in a box with no login and no key: its exit code, and stderr's last lines. Its
 * temp folder is the box's own, outside the copy, where a test may make a throwaway repository.
 */
const inBox = (folder: string, command: readonly string[], reads: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Sandbox;
      const [program = "", ...args] = command;
      const handle = yield* sandbox.start({
        command: program,
        args,
        reads,
        env: {},
        mount: { _tag: "worktree", folder },
        credential: { _tag: "none" },
      });
      const [, tail, code] = yield* Effect.all(
        [
          Stream.runDrain(handle.stdout),
          Stream.runFold(
            handle.stderr.pipe(Stream.decodeText(), Stream.splitLines),
            (): readonly string[] => [],
            (kept, line) => [...kept.slice(1 - TAIL_LINES), line],
          ),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { code: Number(code), tail: tail.join("\n") };
    }),
  );

export const laneTestsWork = Layer.effect(
  TestsWork,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const runner = yield* MutationRunner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const box = Layer.provide(layerOs({ parent: process.env }), nodeServices);
    /**
     * The test command on `commit`, and vitest's report read back. A run that could not run fails with
     * its cause (tracker 193): why, the box's exit code, how long it went, and stderr's tail as a
     * public ticket may show it.
     */
    const tested = (commit: string) =>
      Effect.gen(function* () {
        const from = yield* Clock.currentTimeMillis;
        const failing = (why: RunWhy, code: number | null, tail: string, folders: readonly string[] = []) =>
          Effect.flatMap(Clock.currentTimeMillis, (to) =>
            Effect.fail({
              _tag: "could_not_run",
              why,
              code,
              ms: to - from,
              tail: publicText(tail, folders),
            } satisfies RunFailure),
          );
        const settings = yield* work.settings.pipe(
          Effect.catch((e) => failing("no_command", null, e.says ?? "the settings could not be read")),
        );
        const run = settings.test_writer?.run;

        if (run === undefined) {
          return yield* failing("no_command", null, "[test_writer] run is not set");
        }

        const folder = yield* work
          .copy(commit)
          .pipe(Effect.catch((e) => failing("copy_failed", null, e.says ?? `no copy of ${commit}`)));
        // The box starts its program in the copy, so a copy that is not a folder fails here, by name.
        const kind = yield* fs.stat(folder).pipe(
          Effect.map((info) => info.type),
          Effect.catch((e) => failing("copy_failed", null, e.message, [folder])),
        );

        if (kind !== "Directory") {
          return yield* failing("copy_failed", null, "the copy is not a folder", [folder]);
        }

        const out = path.join(folder, ".lane-report.json");
        yield* fs.remove(out, { force: true }).pipe(Effect.ignore);
        const ran = yield* inBox(
          folder,
          run.map((word) => word.replaceAll("{out}", out)),
          settings.test_writer?.reads ?? [],
        ).pipe(
          Effect.provide(box),
          Effect.catch((e) => failing("box_failed", null, e.message, [folder])),
        );
        const text = yield* fs
          .readFileString(out)
          .pipe(Effect.catch(() => failing("no_report", ran.code, ran.tail, [folder])));
        const report = yield* Schema.decodeEffect(Schema.fromJsonString(Report))(text).pipe(
          Effect.catch(() => failing("bad_report", ran.code, ran.tail, [folder])),
        );
        return { code: ran.code, report };
      });
    const records = (ticket: string) => work.at("checked", `${encodeURIComponent(ticket)}.json`);
    return {
      taken: (base, includes) =>
        work.listAt(work.at("clone"), base).pipe(
          Effect.map((files) => files.filter(includedBy(includes))),
          Effect.mapError(() => failed),
        ),
      // Through the repository's formatter first. One that failed keeps what it wrote: the lane says so
      // before the next build round, or after the mutants' answers, where it formats the exam again.
      commit: (ticket, _base, files) =>
        Effect.gen(function* () {
          const { tree } = yield* work.tree(numberOf(ticket));
          yield* work.write(tree, files);
          yield* work.format(
            tree,
            files.map((file) => file.path),
          );
          return yield* work.commit(tree, [], `tests for ${ticket}`);
        }).pipe(Effect.mapError(() => failed)),
      onBase: (commit, tests) => tested(commit).pipe(Effect.map(({ report }) => resultsOf(report, tests))),
      record: (ticket, _written, checked) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(work.at("checked"), { recursive: true });
          yield* fs.writeFileString(records(ticket), JSON.stringify(checked));
          return null;
        }).pipe(Effect.mapError(() => failed)),
      checked: (ticket) =>
        fs.readFileString(records(ticket)).pipe(
          Effect.map((text) => JSON.parse(text)),
          Effect.mapError(() => failed),
        ),
      // With the mutant in: Stryker again, on its own line. Out of the survivors, the new test killed it.
      kill: (on) =>
        Effect.gen(function* () {
          if (on.mutant === null) {
            const { report } = yield* tested(on.commit);
            const [one] = resultsOf(report, [{ property: "p", file: on.file, name: on.test }]);
            return one === undefined ? yield* Effect.fail(couldNotRun) : one.result;
          }

          const { file, line } = placeIn(on.mutant);
          yield* work.copy(on.commit);
          const ran = yield* runner.run({
            head: on.commit,
            spans: [{ file, from: line, to: line }],
            seed: 1,
            most: MAX_MUTANTS,
          });
          return ran.survived.some((s) => s.mutant === on.mutant) ? ("green" as const) : ("red" as const);
        }).pipe(Effect.mapError(() => couldNotRun)),
    };
  }),
).pipe(Layer.provide(nodeServices));

export const laneTestsAgents = Layer.effect(
  TestsAgents,
  Effect.gen(function* () {
    const lane = yield* LaneNow;
    const agents = yield* LaneAgents;
    const on = <N extends string, O>(name: N, output: Schema.Schema<O>, sub: Sub<N, DraftRun>) =>
      Stream.unwrap(
        draftRunner(name, output as never).pipe(
          Effect.provideService(LaneNow, lane),
          Effect.provideService(LaneAgents, agents),
          Effect.map((runner) => runner(sub as never)),
        ),
      );
    return {
      write: (sub) => on("tests_write", Written, sub) as never,
      answer: (sub) => on("mutants_answer", Answered, sub) as never,
    };
  }),
);

/**
 * The pull request on this branch. Resumed after a kill, the one opened before is the one. Else the
 * code host is told. A step's failure keeps no words, so what the host said goes on the ticket.
 */
const pullOnBranch = (
  {
    pulls,
    wire,
    tickets,
  }: {
    readonly pulls: LanePulls["Service"];
    readonly wire: PullWire["Service"];
    readonly tickets: Tickets["Service"];
  },
  number: number,
  pull: { readonly branch: string; readonly title: string; readonly body: string },
) =>
  Effect.flatMap(pulls.onBranch(pull.branch), (known) =>
    known !== null
      ? Effect.succeed(known)
      : wire.open(pull).pipe(
          Effect.tapError(({ says }) =>
            says === undefined
              ? Effect.void
              : Effect.ignore(
                  tickets.talk(number, `open-failed/${pull.branch}`, {
                    type: "commented",
                    body: says,
                  }),
                ),
          ),
        ),
  );

export const laneExamWork = Layer.effect(
  ExamWork,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const pulls = yield* LanePulls;
    const wire = yield* PullWire;
    const tickets = yield* Tickets;
    const lane = yield* LaneNow;
    const agents = yield* LaneAgents;
    /**
     * The side tree, at `base`: a redo's base is the head it was sent back from, where it is. A first
     * landing's is main, and so is a redo's after main would not merge: an older exam's tree, a plan's
     * older version's or the conflicting head starts again from main when `base` is no fast-forward of
     * it. A tree ahead of `base` starts again too: a plan's older version's holds main under its own
     * rule changes.
     */
    const sideAt = (name: string, base: string) =>
      Effect.gen(function* () {
        const side = yield* work.side(name);

        if ((yield* work.head(side.tree)) === base) {
          return side;
        }

        return (yield* work.sideTo(name, base)) === "moved" ? side : yield* work.sideFresh(name);
      });
    return {
      land: (_ticket, number, base, files, changes) =>
        Effect.gen(function* () {
          const side = yield* sideAt(`exam-${number}`, base);
          // Through the repository's formatter first, as the test writer's tests go (self-fix PR 10).
          yield* work.write(side.tree, files);
          const formatted = yield* work.format(
            side.tree,
            files.map((file) => file.path),
          );

          if (formatted._tag === "none") {
            yield* tickets.talk(number, "format-none", { type: "commented", body: NO_FORMATTER }).pipe(Effect.ignore);
          }

          if (formatted._tag === "failed") {
            yield* tickets
              .talk(number, `format-exam-pr-failed/${side.branch}`, {
                type: "commented",
                body: saidOf(
                  `The formatter failed on the rule changes, so they are kept as the exam writer wrote them. ${formatted.says}`,
                ),
              })
              .pipe(Effect.ignore);
          }

          const head = yield* work.commit(side.tree, [], `rule changes for ticket ${number}`);
          yield* pushBranch({ work, tickets }, number, side.tree, head, side.branch);
          const title = `Rule changes for ticket ${number}`;
          const body = saidOf(
            [
              `The rule changes the plan for ticket ${number} lists. They land before the rest of its work.`,
              "",
              ...ruleChangeLines(changes),
            ].join("\n"),
          );
          const id = yield* pullOnBranch({ pulls, wire, tickets }, number, {
            branch: side.branch,
            title,
            body,
          });
          const pr = yield* pulls.open(
            {
              kind: "exam",
              ticket: number,
              branch: side.branch,
              head,
              tree: side.tree,
              title,
              body,
              book: examBook(changes),
            },
            id ?? undefined,
          );
          return { pr, head };
        }).pipe(Effect.mapError(() => failed)),
      write: (sub) =>
        Stream.unwrap(
          draftRunner("exam_write", ExamWritten as never).pipe(
            Effect.provideService(LaneNow, lane),
            Effect.provideService(LaneAgents, agents),
            Effect.map((runner) => runner(sub as never) as never),
          ),
        ),
    };
  }),
);

export const lanePushWork = Layer.effect(
  PushWork,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const pulls = yield* LanePulls;
    const wire = yield* PullWire;
    const tickets = yield* Tickets;
    return {
      push: (_ticket, number, head) =>
        Effect.gen(function* () {
          const { tree, branch } = yield* work.tree(number);
          yield* pushBranch({ work, tickets }, number, tree, head, branch);
          return null;
        }),
      open: (_ticket, number, head, title, body) =>
        Effect.gen(function* () {
          const { tree, branch } = yield* work.tree(number);
          const id = yield* pullOnBranch({ pulls, wire, tickets }, number, { branch, title, body });
          return yield* pulls.open({ kind: "lane", ticket: number, branch, head, tree, title, body }, id ?? undefined);
        }),
      post: (pr, head, posts) =>
        Effect.gen(function* () {
          yield* wire.post(pr, head, posts);
          yield* pulls.post(
            pr,
            head,
            posts.map((p) => ({ kind: p.kind, verdict: p.verdict })),
          );
          return null;
        }),
    };
  }),
);

export const laneMutationScope = Layer.effect(
  MutationScope,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    return {
      read: (base, head, kept, exam) =>
        Effect.gen(function* () {
          const files = yield* work.changedFiles(base, head);
          const added = (yield* Effect.forEach(
            files,
            (file) => Effect.map(work.diff(base, head, file), (diff) => addedIn(file, diff)),
            { concurrency: 1 },
          )).flat();
          // `show` answers `null` only for a file that is not there. A read that broke fails this
          // read, so it never looks like a kept function or an exam file that went away.
          const spans = yield* Effect.forEach(
            kept,
            (ref) =>
              Effect.map(work.show(head, ref.file), (text) => (text === null ? [] : spanIn(ref.file, text, ref.name))),
            { concurrency: 1 },
          );
          const checksums = yield* Effect.forEach(
            exam,
            (file) =>
              Effect.map(work.show(head, file), (text) => ({
                file,
                hash: text === null ? null : hashOf(text),
              })),
            { concurrency: 1 },
          );
          return { diff: { files, added }, kept: spans.flat(), exam: checksums };
        }),
    };
  }),
);

/**
 * Code's own `[build] checks`, as the repo's settings name them at each run, in a git worktree of the
 * head made and installed for this run alone (`LaneWork.worktree`), as CI checks a checkout. Not a
 * `git archive` copy: a check that asks git, as `pnpm lint` does, finds no repository in one (tracker
 * ticket 184). What could not be set up is `not_run`, never green.
 */
export const laneCheckRunner = Layer.effect(
  CheckRunner,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    return {
      run: (head) =>
        Effect.gen(function* () {
          // What git or an install said goes on a public ticket: no home path, no key.
          const notRun = (commands: readonly string[], tail: string): CheckRun => ({
            head,
            commands: commands.map((command) => ({ command, code: null, ms: 0 })),
            result: "not_run",
            failed: [],
            tail: publicText(tail),
          });
          const settings = yield* Effect.result(work.settings);

          if (settings._tag === "Failure") {
            return notRun(
              [],
              `The repository's settings could not be read, so no check ran at ${head}. ${settings.failure.says ?? ""}`.trim(),
            );
          }

          const build = settings.success.build;
          const commands = build?.checks ?? [];
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const worktree = yield* Effect.result(work.worktree(head));

              if (worktree._tag === "Failure") {
                return notRun(
                  commands.map((command) => command.join(" ")),
                  `The worktree of ${head} could not be made, so no check ran there. ${worktree.failure.says ?? ""}`.trim(),
                );
              }

              const folder = worktree.success;
              return yield* Effect.provide(
                Effect.gen(function* () {
                  return yield* (yield* CheckRunner).run(head);
                }),
                checkRunner({
                  folder: () => folder,
                  commands,
                  within: Duration.seconds(build?.checks_within ?? CHECKS_WITHIN),
                }),
              );
            }),
          );
        }),
    };
  }),
);

/** Stryker, set up from the repo's own settings when the first run needs it. */
export const laneMutationRunner = Layer.effect(
  MutationRunner,
  Effect.gen(function* () {
    const work = yield* LaneWork;
    const home = yield* LaneHome;
    const runner = yield* Effect.cached(
      Effect.gen(function* () {
        const settings = yield* work.settings;
        const tests = settings.mutation?.tests;
        const typecheck = settings.mutation?.typecheck;

        if (tests === undefined || typecheck === undefined) {
          return yield* Effect.fail(couldNotRun);
        }

        const vitest = settings.mutation?.vitest;
        return yield* Effect.provide(
          Effect.gen(function* () {
            return yield* MutationRunner;
          }),
          strykerRunner({
            folder: (head) => work.at("copies", head),
            tests: tests as never,
            typecheck: typecheck as never,
            ...(vitest === undefined ? {} : { vitest }),
            ...(home.ignorer === undefined ? {} : { ignorer: home.ignorer }),
          }),
        );
      }).pipe(Effect.mapError(() => couldNotRun)),
    );
    const copied = (head: string) => work.copy(head).pipe(Effect.mapError(() => couldNotRun));
    return {
      tests: (head) =>
        Effect.gen(function* () {
          yield* copied(head);
          return yield* (yield* runner).tests(head);
        }),
      run: (ask) =>
        Effect.gen(function* () {
          yield* copied(ask.head);
          return yield* (yield* runner).run(ask);
        }),
    };
  }),
);
