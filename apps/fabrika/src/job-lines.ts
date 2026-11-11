import type { JobTable } from "@kampus/fabrika-old";
import { JobAnswer, KeptLines } from "@kampus/fabrika-old/mcp";
import { Effect } from "effect";
import type { TileId } from "./desk/layout/index.ts";
import type { JobEnded, JobNews } from "./tile-jobs.ts";

// What the host knows of each job beyond its table: the lines tsh printed for it, and, once it
// has ended, how. The table (`openJobs`) says which jobs there are and whether each runs; it keeps
// no lines and forgets a job once it ends. So the lines are kept here as each tile's tsh prints
// them (each `printed` carries its job's `%n`), and an end as the tile sees it (tile-jobs.ts).
// It is what the agents' `job` tool reads (host/agents.ts), as tmux's `capture-pane` reads a pane.
//
//   const lines = yield* jobLines(jobs.table);
//   // t1's tsh runs `seq --to 5`, job %1:  news("t1").began, printed(1, "1") ... printed(1, "5"),
//   //                                     news("t1").ended {how: "done"}
//   lines.job(1)
//   // {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"}, lines: ["1", ..., "5"]}
//   lines.job(2)    // in the table, from before the host started again: {_tag: "detached"}, no lines
//   lines.job(99)   // null: the host knows no job 99
//
// Each begin and end is one line in the host's log, `key=value`, as the log's other lines:
//
//   level=INFO message=job_began n=1 "text=seq --to 5" tile=t1 by=user:owner
//   level=INFO message=job_ended n=1 "text=seq --to 5" tile=t1 how=done by=user:owner
//
// `by` is who started the job, as the table keeps it (tracker 185). A stop says who asked it, and
// why, as it is asked, before the end it asks for; a person's own Ctrl-C or `stop %n` gives no why:
//
//   level=INFO message=job_stopped n=2 by=user:owner whose=user:owner idle_ms=0
//
// `whose` is the job's own writer, beside `by`, who asked the stop: an agent's `stop` tool stops
// the person's jobs too. `idle_ms` is how long since the person's last key, a key on the desk or
// in a tile, so the log can say whether an agent stops work the person is in the middle of. With
// no key since the host started, it is not said.
//
//   level=INFO message=job_stopped n=1 "by=agent:claude for:owner" "why=wrong ticket" whose=user:owner idle_ms=8000
//
// In memory only: a host started again knows its table's jobs, never their lines. Bounded: each
// job's lines are the newest any answer could show (`KeptLines`, about 25 KB at most), kept for
// the newest `JOBS_KEPT` jobs; a job still in the table keeps its lines, whatever its age.

/**
 * The jobs whose lines and end the host keeps after they leave its table. Our own bound, not a
 * source's: 100 jobs of at most about 25 KB of lines each is about 2.5 MB at most in the host.
 */
const JOBS_KEPT = 100;

const State = JobAnswer.fields.state;

export interface JobLines {
  /** What one tile's tsh says of its jobs as each begins and ends (tile-jobs.ts). */
  readonly news: (tile: TileId) => JobNews;
  /** tsh printed `text` for job `n`. */
  readonly printed: (n: number, text: string) => void;
  /** Job n now, with every line kept of it; `null`: the host knows none. */
  readonly job: (n: number) => JobAnswer | null;
  /** Done with job n as `job` answers it once its tile has said it ended: at once, if it has. */
  readonly ended: (n: number) => Effect.Effect<JobAnswer>;
}

/**
 * The host's job lines, beside its `table`, until the scope closes. Its log lines go to the
 * loggers it is made with. `idle`: how long since the person's last key, for a stop's line;
 * `null`: no key since the host started.
 */
export const jobLines = (table: JobTable, idle: () => number | null = () => null) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const log = (message: string, fields: Readonly<Record<string, unknown>>) => {
      Effect.runForkWith(services)(Effect.logInfo(message).pipe(Effect.annotateLogs(fields)));
    };
    /** Who started each job this host saw begin, by `%n`, until its end is said. */
    const writers = new Map<number, string>();
    /** `by=`, when the table knows who: a job kept before jobs had a writer says none. */
    const byOf = (by: string | null | undefined) => (by == null ? {} : { by });

    // A stop as it is asked, before the end it asks for: once per job. The stops already in the
    // table when the host starts were said by the host that took them.
    const stopped = new Set(
      table
        .getState()
        .jobs.filter((job) => job.stop !== null)
        .map((job) => job.n),
    );
    const stops = () => {
      const jobs = table.getState().jobs;

      for (const job of jobs) {
        if (job.stop === null || stopped.has(job.n)) {
          continue;
        }

        stopped.add(job.n);
        const since = idle();
        log("job_stopped", {
          n: job.n,
          by: job.stop.by,
          ...(job.stop.why === null ? {} : { why: job.stop.why }),
          // Whose it was beside who stopped it, and how long the person had been away: does an
          // agent stop work the person is in the middle of?
          ...(job.by === null ? {} : { whose: job.by }),
          ...(since === null ? {} : { idle_ms: since }),
        });
      }

      for (const n of stopped) {
        if (!jobs.some((job) => job.n === n)) {
          stopped.delete(n);
        }
      }
    };
    const unsubscribe = table.subscribe(stops);
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    /** Each job's lines, by `%n`, oldest job first: numbers only grow. */
    const kept = new Map<number, KeptLines>();
    /** How each job ended, as its tile saw it, oldest first. */
    const ended = new Map<number, { readonly tile: TileId; readonly job: JobEnded }>();
    const inTable = (n: number) => table.getState().jobs.some((job) => job.n === n);
    /** Who waits for each job's end (`ended`), by `%n`: each is told once, as the tile says it. */
    const waiting = new Map<number, Set<(job: JobAnswer) => void>>();

    /** Forget the oldest jobs past `JOBS_KEPT`, but none the table still holds. */
    const forget = () => {
      for (const n of ended.keys()) {
        if (ended.size <= JOBS_KEPT) {
          break;
        }

        ended.delete(n);
      }

      for (const n of kept.keys()) {
        if (kept.size <= JOBS_KEPT) {
          break;
        }

        if (!inTable(n)) {
          kept.delete(n);
        }
      }
    };

    const lines: JobLines = {
      news: (tile) => ({
        began: (job) => {
          const by = table.getState().jobs.find((row) => row.n === job.n)?.by ?? null;

          if (by !== null) {
            writers.set(job.n, by);
          }

          log("job_began", { n: job.n, text: job.text, tile, ...byOf(by) });
        },
        ended: (job) => {
          ended.set(job.n, { tile, job });
          forget();
          const by = writers.get(job.n);
          writers.delete(job.n);
          log("job_ended", { n: job.n, text: job.text, tile, how: job.how, ...byOf(by) });
          const heard = waiting.get(job.n);
          const now = lines.job(job.n);
          waiting.delete(job.n);

          if (now !== null) {
            for (const tell of heard ?? []) {
              tell(now);
            }
          }
        },
      }),
      printed: (n, text) => {
        const one = kept.get(n);

        if (one !== undefined) {
          return one.push(text);
        }

        const fresh = new KeptLines();
        fresh.push(text);
        kept.set(n, fresh);
        forget();
      },
      job: (n) => {
        const shown = [...(kept.get(n)?.lines ?? [])];
        const row = table.getState().jobs.find((job) => job.n === n);

        if (row !== undefined) {
          return {
            n,
            text: row.text,
            tile: row.owner,
            state: row.state === "running" ? State.cases.running.make({}) : State.cases.detached.make({}),
            lines: shown,
          };
        }

        const end = ended.get(n);

        if (end === undefined) {
          return null;
        }

        return {
          n,
          text: end.job.text,
          tile: end.tile,
          state: State.cases.ended.make({ how: end.job.how }),
          lines: shown,
        };
      },
      ended: (n) =>
        Effect.callback<JobAnswer>((resume) => {
          const now = lines.job(n);

          if (now?.state._tag === "ended") {
            return resume(Effect.succeed(now));
          }

          const one = (job: JobAnswer) => resume(Effect.succeed(job));
          const all = waiting.get(n) ?? new Set();
          all.add(one);
          waiting.set(n, all);
          return Effect.sync(() => {
            all.delete(one);

            if (all.size === 0 && waiting.get(n) === all) {
              waiting.delete(n);
            }
          });
        }),
    };
    return lines;
  });
