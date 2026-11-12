import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import * as fc from "fast-check";
import { Change, CodeHost, CodeHostError, Commit, Merged, Tree, Updated } from "./CodeHost.ts";

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check's synchronous command interface
const sync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);

// oxlint-disable-next-line fabrika/no-redacted-value -- edge: S1 puts a made-up token in scripted service failures
const reveal = (token: Redacted.Redacted<string>) => Redacted.value(token);

export type ChangeData = typeof Change.cases.found.Type & {
  readonly base: typeof Commit.Type;
  readonly tree: typeof Tree.Type;
  readonly conflict: ReadonlyArray<string> | null;
};

export type Method = "change" | "update" | "merge";

export type Fault =
  | { readonly kind: "fault"; readonly reason: CodeHostError["reason"] }
  | { readonly kind: "defect" }
  | { readonly kind: "interrupt" };

export type Call = { readonly method: Method; readonly change: number; readonly head?: typeof Commit.Type };

export class Control extends Context.Service<
  Control,
  {
    readonly put: (change: ChangeData) => Effect.Effect<void>;
    readonly main: (head: typeof Commit.Type) => Effect.Effect<void>;
    readonly fail: (method: Method, fault: Fault) => Effect.Effect<void>;
    readonly crashMerge: Effect.Effect<void>;
    readonly calls: () => ReadonlyArray<Call>;
    readonly read: (change: number) => Effect.Effect<ChangeData | undefined>;
  }
>()("@kampus/libfabrika/codehost/CodeHostTest/Control") {}

export const commit = (hex: string) => Schema.decodeUnknownSync(Commit)(hex);
export const tree = (hex: string) => Schema.decodeUnknownSync(Tree)(hex);

export const layer = (options: { readonly token?: Redacted.Redacted<string> } = {}): Layer.Layer<CodeHost | Control> =>
  Layer.effectContext(
    Effect.sync(() => {
      const changes = new Map<number, ChangeData>();
      const updates = new Map<string, typeof Updated.cases.updated.Type>();
      const merges = new Map<string, typeof Merged.cases.merged.Type>();
      const faults: Record<Method, Array<Fault>> = { change: [], update: [], merge: [] };
      const calls: Array<Call> = [];
      let main = commit("0".repeat(40));
      let serial = 1;
      const used = new Set<string>([main]);
      let crash = false;
      const fresh = (size: number) => {
        let id: string;

        do {
          id = (serial++).toString(16).padStart(size, "f");
        } while (used.has(id));

        used.add(id);
        return id;
      };
      const failure = (call: Call) =>
        Effect.suspend(() => {
          calls.push(call);
          const fault = faults[call.method].shift();
          const cause = new Error(options.token === undefined ? "scripted host failure" : reveal(options.token));

          if (fault?.kind === "fault") {
            return Effect.fail(new CodeHostError({ reason: fault.reason, cause }));
          }

          if (fault?.kind === "defect") {
            return Effect.die(cause);
          }

          if (fault?.kind === "interrupt") {
            return Effect.interrupt;
          }

          return Effect.void;
        });
      const host = CodeHost.of({
        change: (change) =>
          failure({ method: "change", change }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                const found = changes.get(change);
                return found === undefined
                  ? Change.cases.missing.make({ change })
                  : Change.cases.found.make({ change, head: found.head, state: found.state, paths: found.paths });
              }),
            ),
          ),
        update: (change, head) =>
          failure({ method: "update", change, head }).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                const found = changes.get(change);

                if (found === undefined) {
                  return Effect.fail(new CodeHostError({ reason: "refused" }));
                }

                if (found.state !== "open") {
                  return Effect.succeed(Updated.cases.closed.make({ state: found.state }));
                }

                const previous = updates.get(JSON.stringify([change, head]));

                if (previous !== undefined && found.head === previous.head) {
                  return Effect.succeed(previous);
                }

                if (found.head !== head) {
                  return Effect.succeed(Updated.cases.moved.make({ head: found.head }));
                }

                if (found.conflict !== null) {
                  return Effect.succeed(Updated.cases.conflict.make({ main, paths: found.conflict }));
                }

                if (found.base === main) {
                  return Effect.succeed(Updated.cases.current.make({ head, tree: found.tree, main }));
                }

                const updated = Updated.cases.updated.make({
                  head: commit(fresh(head.length)),
                  tree: tree(fresh(head.length)),
                  main,
                });
                changes.set(change, { ...found, head: updated.head, tree: updated.tree, base: main });
                updates.set(JSON.stringify([change, head]), updated);
                return Effect.succeed(updated);
              }),
            ),
          ),
        merge: (change, head) =>
          failure({ method: "merge", change, head }).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                const previous = merges.get(JSON.stringify([change, head]));

                if (previous !== undefined) {
                  return Effect.succeed(previous);
                }

                const found = changes.get(change);

                if (found === undefined) {
                  return Effect.fail(new CodeHostError({ reason: "refused" }));
                }

                if (found.state === "draft" || found.state === "closed") {
                  return Effect.succeed(Merged.cases.closed.make({ state: found.state }));
                }

                if (found.head !== head) {
                  return Effect.succeed(Merged.cases.moved.make({ head: found.head }));
                }

                if (found.conflict !== null) {
                  return Effect.succeed(Merged.cases.conflict.make({ main, paths: found.conflict }));
                }

                const merged = Merged.cases.merged.make({ commit: commit(fresh(head.length)), tree: found.tree });
                changes.set(change, { ...found, state: "merged" });
                main = merged.commit;
                merges.set(JSON.stringify([change, head]), merged);

                if (crash) {
                  crash = false;
                  return Effect.interrupt;
                }

                return Effect.succeed(merged);
              }),
            ),
          ),
      });
      return Context.make(CodeHost, host).pipe(
        Context.add(Control, {
          put: (data: ChangeData) =>
            Effect.sync(() => {
              changes.set(data.change, data);
              used.add(data.head);
              used.add(data.base);
              used.add(data.tree);
            }),
          main: (head: typeof Commit.Type) =>
            Effect.sync(() => {
              main = head;
              used.add(head);
            }),
          fail: (method: Method, fault: Fault) =>
            Effect.sync(() => {
              faults[method].push(fault);
            }),
          crashMerge: Effect.sync(() => {
            crash = true;
          }),
          calls: () => [...calls],
          read: (change: number) => Effect.sync(() => changes.get(change)),
        }),
      );
    }),
  );

export const suite = (testLayer: Layer.Layer<CodeHost | Control>) =>
  describe.each([40, 64])("C1: the code host contract (%i-character ids)", (size) => {
    it("pins every call, repeats completed writes and forgets an update's pin after a later push", () => {
      type Model = {
        changes: Map<number, ChangeData>;
        main: typeof Commit.Type;
        updates: Map<number, { asked: typeof Commit.Type; answer: typeof Updated.Type }>;
        merges: Map<number, { asked: typeof Commit.Type; answer: typeof Merged.Type }>;
        size: number;
        serial: number;
      };
      type Real = { host: CodeHost["Service"]; control: Control["Service"] };
      type Cell = {
        move: number;
        pick: number;
        state: "open" | "draft" | "closed";
        head: string;
        conflict: ReadonlyArray<string> | null;
      };
      const command = (cell: Cell): fc.Command<Model, Real> => ({
        check: () => true,
        run: (m, r) => {
          const id = (cell.pick % 4) + 1;
          const found = m.changes.get(id);
          m.serial++;
          const hex = (salt: number) => (m.serial * 16 + salt + 10).toString(16).padStart(m.size, "0");

          if (found === undefined || cell.move % 7 === 0) {
            const data: ChangeData = {
              ...Change.cases.found.make({
                change: id,
                head: commit(found === undefined ? cell.head.slice(-m.size) : hex(1)),
                state: cell.state,
                paths: ["src/a.ts"],
              }),
              base: cell.pick % 2 === 0 ? m.main : commit(hex(2)),
              tree: tree(hex(3)),
              conflict: cell.conflict,
            };
            m.changes.set(id, data);
            m.updates.delete(id);
            m.merges.delete(id);
            sync(r.control.put(data));
          } else if (cell.move % 7 === 1) {
            m.main = commit(hex(5));
            sync(r.control.main(m.main));
          } else if (cell.move % 7 === 2) {
            const changed = { ...found, head: commit(hex(6)) };
            m.changes.set(id, changed);
            sync(r.control.put(changed));
            const previous = m.updates.get(id);

            if (changed.state === "open" && previous?.answer._tag === "updated") {
              expect(sync(r.host.update(id, previous.asked))).toEqual(Updated.cases.moved.make({ head: changed.head }));
            }
          } else if (cell.move % 7 === 3) {
            const answer = sync(r.host.change(id));
            expect(Schema.is(Change)(answer)).toBe(true);
            expect(answer).toMatchObject({ change: id, head: found.head, state: found.state, paths: found.paths });
          } else {
            const merging = cell.move % 7 === 4;
            const previous = merging ? m.merges.get(id) : m.updates.get(id);
            const head =
              previous !== undefined && (cell.pick % 2 === 0 || (merging && found.state === "merged"))
                ? previous.asked
                : cell.pick % 3 === 0
                  ? commit(hex(7))
                  : found.head;
            const answer = sync(merging ? r.host.merge(id, head) : r.host.update(id, head));
            expect(Schema.is(merging ? Merged : Updated)(answer)).toBe(true);

            for (const key of ["head", "tree", "main", "commit"] as const) {
              if (key in answer) {
                expect(String(Reflect.get(answer, key)).length).toBe(head.length);
              }
            }

            if (merging && m.merges.get(id)?.asked === head) {
              expect(answer).toEqual(m.merges.get(id)?.answer);
            } else if (found.state !== "open") {
              expect(answer).toEqual(Updated.cases.closed.make({ state: found.state }));
            } else if (
              !merging &&
              previous?.asked === head &&
              previous.answer._tag === "updated" &&
              previous.answer.head === found.head
            ) {
              expect(answer).toEqual(previous.answer);
            } else if (head !== found.head) {
              expect(answer).toEqual(Updated.cases.moved.make({ head: found.head }));
              expect(answer._tag === "moved" && answer.head).not.toBe(head);
            } else if (found.conflict !== null) {
              expect(answer).toEqual(Updated.cases.conflict.make({ main: m.main, paths: found.conflict }));
            } else if (merging) {
              expect(answer._tag).toBe("merged");

              if (answer._tag === "merged") {
                m.merges.set(id, { asked: head, answer });
                m.changes.set(id, { ...found, state: "merged" });
                m.main = answer.commit;
                expect(sync(r.host.merge(id, head))).toEqual(answer);
              }
            } else if (found.base === m.main) {
              expect(answer).toEqual(Updated.cases.current.make({ head, tree: found.tree, main: m.main }));
            } else {
              expect(answer._tag).toBe("updated");

              if (answer._tag === "updated") {
                expect(answer.head).not.toBe(head);
                expect(answer.main).toBe(m.main);
                m.updates.set(id, { asked: head, answer });
                m.changes.set(id, { ...found, head: answer.head, tree: answer.tree, base: m.main });
                expect(sync(r.host.update(id, head))).toEqual(answer);

                if (cell.pick % 3 !== 0) {
                  const pushed = { ...found, head: commit(hex(8)), tree: answer.tree, base: m.main };
                  m.changes.set(id, pushed);
                  sync(r.control.put(pushed));
                  expect(sync(r.host.update(id, head))).toEqual(Updated.cases.moved.make({ head: pushed.head }));
                }
              }
            }
          }

          expect(sync(r.host.change(999))).toEqual(Change.cases.missing.make({ change: 999 }));
        },
        toString: () => JSON.stringify(cell),
      });
      const commandArb = fc
        .record({
          move: fc.nat(),
          pick: fc.nat(),
          state: fc.constantFrom("open", "draft", "closed"),
          head: fc.oneof(
            fc
              .array(fc.constantFrom(..."0123456789abcdef"), { minLength: 64, maxLength: 64 })
              .map((digits) => digits.join("")),
            fc.integer({ min: 1, max: 32 }).map((n) => n.toString(16).padStart(64, "f")),
          ),
          conflict: fc.option(fc.array(fc.constantFrom("a b", "dir/[x]", ".dot")), { nil: null }),
        })
        .map(command);
      // pinned: the host's first generated head used to equal an f-padded input in either hash format.
      const collision = { move: 0, pick: 1, state: "open", head: "1".padStart(64, "f"), conflict: null } as const;
      const collisionWalk = [command(collision), command({ ...collision, move: 5 })];
      fc.assert(
        fc.property(fc.commands([commandArb], { maxCommands: 70 }), (commands) => {
          sync(
            Effect.scoped(
              Effect.gen(function* () {
                const context = yield* Layer.build(testLayer);
                const real = { host: Context.get(context, CodeHost), control: Context.get(context, Control) };
                expect(yield* real.host.change(1)).toEqual(Change.cases.missing.make({ change: 1 }));
                const main = commit("0".repeat(size));
                yield* real.control.main(main);
                fc.modelRun(
                  () => ({
                    model: { changes: new Map(), updates: new Map(), merges: new Map(), main, size, serial: 0 },
                    real,
                  }),
                  commands,
                );
              }),
            ),
          );
        }),
        { seed: 119120, numRuns: 100, examples: [[collisionWalk]] },
      );
    });
  });
