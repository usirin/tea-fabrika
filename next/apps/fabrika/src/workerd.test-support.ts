// next/, test support. Kills the one workerd under a parent process, for the real-workerd crash laws
// (stage-wire's cases A and C, worker-supervision's case B). Read through its module, as port.test-support is.
import { NodeServices } from "@effect/platform-node";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/process";

const processes = Effect.gen(function* () {
  const ps = yield* ChildProcess.make("ps", ["-axo", "pid=,ppid=,command="]);
  return yield* ps.stdout.pipe(Stream.decodeText(), Stream.mkString);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** The pid of the one `workerd` among `parent`'s descendants. More or fewer than one fails the test. */
const workerd = Effect.fn("workerd.find")(function* (parent: number) {
  const rows = (yield* processes).split("\n");
  const found = new Set([parent]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const row of rows) {
      const m = /^\s*(\d+)\s+(\d+)\s+/.exec(row);

      if (m !== null && found.has(Number(m[2])) && !found.has(Number(m[1]))) {
        found.add(Number(m[1]));
        grew = true;
      }
    }
  }

  const pids = rows
    .filter((row) => /\/workerd(?:\s|$)/.test(row))
    .map((row) => Number(row.trim().split(/\s+/)[0]))
    .filter((pid) => found.has(pid));

  const [only] = pids;

  if (pids.length !== 1 || only === undefined) {
    return yield* Effect.die(new Error(`expected one workerd under pid ${parent}, found ${pids.length}`));
  }

  return only;
});

/** SIGKILLs the one workerd under `parent`, which restarts it alone, and answers its old pid. */
export const killWorkerd = Effect.fn("workerd.kill")(function* (parent: number) {
  const pid = yield* workerd(parent);
  // edge: Effect's ChildProcess signals only the processes it spawned, and this one is workerd's, found by `ps`
  yield* Effect.sync(() => process.kill(pid, "SIGKILL"));
  return pid;
});
