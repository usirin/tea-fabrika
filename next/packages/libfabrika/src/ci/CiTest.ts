import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import type { CheckRun } from "./Ci.ts";
import { Checks, Ci, CiError, RateLimited, Status, Unavailable } from "./Ci.ts";

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's synchronous command interface
const sync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);

const item = <A>(items: ReadonlyArray<A>, n: number): A => {
  const found = items[n % items.length];

  if (found === undefined) {
    throw new Error("a nonempty command choice is required");
  }

  return found;
};

export type Report = { readonly commit: string; readonly run: typeof CheckRun.Type; readonly order: number | null };

export type Fault =
  | { readonly kind: "fault"; readonly reason: "unavailable" | "rate_limited" }
  | { readonly kind: "defect" }
  | { readonly kind: "interrupt" };

export class Control extends Context.Service<
  Control,
  {
    readonly report: (report: Report) => Effect.Effect<void>;
    readonly fail: (method: "start" | "at", fault: Fault) => Effect.Effect<void>;
    readonly starts: () => ReadonlyArray<string>;
  }
>()("@kampus/libfabrika/ci/CiTest.Control") {}

const rank = (run: typeof CheckRun.Type) => {
  if (run.status._tag !== "done") {
    return 3;
  }

  if (run.status.conclusion === "failure" || run.status.conclusion === "timed_out") {
    return 2;
  }

  if (run.status.conclusion === "cancelled" || run.status.conclusion === "startup_failure") {
    return 1;
  }

  return 0;
};

const reasons = { unavailable: Unavailable, rate_limited: RateLimited };

export const layer = (options: { readonly token?: Redacted.Redacted<string> } = {}): Layer.Layer<Ci | Control> =>
  Layer.effectContext(
    Effect.sync(() => {
      const reports = new Map<string, Map<string, Report>>();
      const started = new Set<string>();
      const faults: Record<"start" | "at", Array<Fault>> = { start: [], at: [] };
      const failure = (method: "start" | "at") =>
        Effect.suspend(() => {
          const fault = faults[method].shift();
          // oxlint-disable-next-line fabrika/no-redacted-value -- edge: S1 deliberately puts a made-up token in service failures
          const cause = new Error(options.token === undefined ? "scripted CI failure" : Redacted.value(options.token));

          if (fault?.kind === "fault") {
            return Effect.fail(new CiError({ reason: new reasons[fault.reason]({ cause }) }));
          }

          if (fault?.kind === "defect") {
            return Effect.die(cause);
          }

          if (fault?.kind === "interrupt") {
            return Effect.interrupt;
          }

          return Effect.void;
        });
      const service = Ci.of({
        start: (commit) =>
          failure("start").pipe(
            Effect.andThen(
              Effect.sync(() => {
                started.add(commit);
              }),
            ),
          ),
        at: (commit) =>
          failure("at").pipe(
            Effect.andThen(
              Effect.sync(() => {
                const groups: Array<Array<Report>> = [];

                for (const report of reports.get(commit)?.values() ?? []) {
                  const group = groups.find(
                    (g) => g[0]?.run.name === report.run.name && g[0]?.run.source === report.run.source,
                  );

                  if (group === undefined) {
                    groups.push([report]);
                  } else {
                    group.push(report);
                  }
                }

                return groups.map((group) => {
                  const unplaced = group.filter((r) => r.order === null);
                  const candidates = unplaced.length > 0 ? unplaced : group;
                  const selected = candidates.reduce((a, b) => {
                    if (unplaced.length === 0 && a.order !== b.order) {
                      return (a.order ?? 0) > (b.order ?? 0) ? a : b;
                    }

                    if (unplaced.length === 0 && rank(a.run) !== rank(b.run)) {
                      return rank(a.run) > rank(b.run) ? a : b;
                    }

                    return a.run.id > b.run.id ? a : b;
                  });
                  return unplaced.length > 0 ? { ...selected.run, status: Status.cases.queued.make({}) } : selected.run;
                });
              }),
            ),
          ),
      });
      return Context.make(Ci, service).pipe(
        Context.add(Control, {
          report: (report: Report) =>
            Effect.sync(() => {
              const commit = reports.get(report.commit) ?? new Map<string, Report>();
              commit.set(report.run.id, report);
              reports.set(report.commit, commit);
            }),
          fail: (method: "start" | "at", fault: Fault) =>
            Effect.sync(() => {
              faults[method].push(fault);
            }),
          starts: () => [...started],
        }),
      );
    }),
  );

export const word = fc.string({ unit: "binary", minLength: 1, maxLength: 24 });

export const status = fc.oneof(
  fc.constant(Status.cases.queued.make({})),
  fc.constant(Status.cases.running.make({})),
  fc
    .constantFrom("success", "failure", "timed_out", "skipped", "neutral", "cancelled", "startup_failure")
    .map((conclusion) => Status.cases.done.make({ conclusion })),
);

export const run = fc.record({
  name: word,
  source: word,
  id: word,
  status,
  startedAt: fc.option(fc.maxSafeNat(), { nil: null }),
  completedAt: fc.option(fc.maxSafeNat(), { nil: null }),
  url: fc.option(word, { nil: null }),
});

const order = fc.option(fc.integer({ min: -2, max: 3 }), { nil: null });

// The oracle filters candidates by the written order, rather than using the Layer's reduction.
const expected = (reports: ReadonlyArray<Report>, commit: string) => {
  const latest = reports.filter(
    (r, i) =>
      r.commit === commit &&
      !reports.slice(i + 1).some((later) => later.commit === commit && later.run.id === r.run.id),
  );
  const keys = latest.filter(
    (r, i) => !latest.slice(0, i).some((p) => p.run.name === r.run.name && p.run.source === r.run.source),
  );
  return keys.map(({ run: key }) => {
    const group = latest.filter((r) => r.run.name === key.name && r.run.source === key.source);
    const unknown = group.filter((r) => r.order === null);
    const pool =
      unknown.length > 0
        ? unknown
        : group.filter((r) => r.order === Math.max(...group.map((p) => p.order ?? -Infinity)));
    const priority = (r: typeof CheckRun.Type) =>
      r.status._tag !== "done"
        ? 4
        : ["failure", "timed_out"].includes(r.status.conclusion)
          ? 3
          : ["cancelled", "startup_failure"].includes(r.status.conclusion)
            ? 2
            : 1;
    const worst =
      unknown.length > 0 ? pool : pool.filter((r) => priority(r.run) === Math.max(...pool.map((p) => priority(p.run))));
    const winner = item(
      worst.toSorted((a, b) => (a.run.id < b.run.id ? 1 : -1)),
      0,
    );
    return unknown.length > 0 ? { ...winner.run, status: Status.cases.queued.make({}) } : winner.run;
  });
};

const sorted = (runs: ReadonlyArray<typeof CheckRun.Type>) =>
  [...runs].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );

export const suite = (testLayer: Layer.Layer<Ci | Control>) =>
  describe("C2: the CI contract", () => {
    it("reports replace their id; selection is current, pessimistic and confined to the commit", () => {
      type Model = { reports: Array<Report>; commits: Array<string>; starts: Set<string> };
      type Real = { ci: Ci["Service"]; control: Control["Service"] };
      const command = fc
        .record({ move: fc.nat(), pick: fc.nat(), report: run, order, commit: word })
        .map((cell): fc.Command<Model, Real> => ({
          check: () => true,
          run: (m, r) => {
            const commit = cell.pick % 3 === 0 ? cell.commit : item(m.commits, cell.pick);

            if (!m.commits.includes(commit)) {
              m.commits.push(commit);
            }

            if (cell.move % 3 === 0) {
              const old = m.reports[cell.pick % Math.max(1, m.reports.length)];
              const report: Report = {
                commit,
                order: cell.order,
                run:
                  cell.pick % 3 !== 0 && old !== undefined
                    ? {
                        ...cell.report,
                        name: old.run.name,
                        source: old.run.source,
                        id: cell.pick % 2 === 0 ? old.run.id : cell.report.id,
                      }
                    : cell.report,
              };
              m.reports.push(report);
              sync(r.control.report(report));
            } else if (cell.move % 3 === 1) {
              sync(r.ci.start(commit));
              sync(r.ci.start(commit));
              m.starts.add(commit);
              expect(new Set(r.control.starts())).toEqual(m.starts);
            }

            for (const head of m.commits) {
              const answer = sync(r.ci.at(head));
              expect(Schema.is(Checks)(answer)).toBe(true);
              expect(sorted(answer)).toEqual(sorted(expected(m.reports, head)));
            }
          },
          toString: () => JSON.stringify(cell),
        }));
      fc.assert(
        fc.property(fc.commands([command], { maxCommands: 45 }), run, (commands, first) => {
          sync(
            Effect.scoped(
              Effect.gen(function* () {
                const context = yield* Layer.build(testLayer);
                const real = { ci: Context.get(context, Ci), control: Context.get(context, Control) };
                expect(yield* real.ci.at("empty")).toEqual([]);
                const reports: Array<Report> = [];

                for (const [index, [name, source]] of (
                  [
                    ["a\u0000b", "c"],
                    ["a", "b\u0000c"],
                  ] as const
                ).entries()) {
                  const report = {
                    commit: "commit",
                    order: 0,
                    run: { ...first, id: String(index), name, source },
                  };
                  reports.push(report);
                  yield* real.control.report(report);
                }

                fc.modelRun(
                  () => ({ model: { reports, commits: ["commit", "empty"], starts: new Set<string>() }, real }),
                  commands,
                );
                expect(Schema.is(Checks)(yield* real.ci.at("commit"))).toBe(true);
                const latest = reports.filter(
                  (r, i) => !reports.slice(i + 1).some((p) => p.commit === r.commit && p.run.id === r.run.id),
                );
                const second = yield* Layer.build(testLayer);
                const control = Context.get(second, Control);

                for (const report of latest.toReversed()) {
                  yield* control.report(report);
                }

                for (const commit of new Set(reports.map((r) => r.commit))) {
                  expect(sorted(yield* Context.get(second, Ci).at(commit))).toEqual(sorted(yield* real.ci.at(commit)));
                }
              }),
            ),
          );
        }),
        { seed: 119120, numRuns: 200 },
      );
    });
  });
