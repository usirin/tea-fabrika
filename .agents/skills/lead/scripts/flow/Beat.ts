// Beat.ts: a lane's heartbeat (ticket 685). Today's lead tooling (0064), read through its module:
// `Beat.enter(...)`, `Beat.says(...)`.
//
// While a lane runs, the chain keeps one beat in the lane's chain record: what the chain is doing
// now, since when, when the step's agent last wrote to its event log, and when the chain last wrote
// the beat. The chain writes it on every phase change and every `EVERY` while it runs. A call that
// blocks the chain's one thread (a hung cleanup) stops the beat, so a reader sees how long since
// the chain or its agent acted, not only how long since the step started. Before this, no record
// said which phase a step spent its time in.
//
//   { "at": "2026-11-10T19:10:00Z", "phase": "cleanup", "since": "2026-11-10T19:10:00Z",
//     "agentAt": null }
//   Beat.says(beat, new Date("2026-11-10T21:00:00Z"))
//   // { stuck: true, text: "cleanup for 1h50m, no beat for 1h50m: stuck" }

import { Schema } from "effect";

/**
 * What the chain is doing now. A step's own parts come from its drive machine: `cleanup` (the
 * start's checks, or the box's removal at the end; the box sweep left the start with 0101), `wait` (a slot, the Electron
 * lock or a free typecheck), `box` (the box made), `agent` (the agent's turn), `collect` (the tree
 * read and signed) and `commit` (the backup push). The rest are the chain's own moves; `typecheck`
 * is the wait for CI's typecheck job at the pushed head.
 */
export const PHASES = [
  "cleanup",
  "wait",
  "box",
  "agent",
  "collect",
  "commit",
  "host",
  "judge",
  "pr",
  "typecheck",
  "loosening",
  "land",
] as const;

export type Phase = (typeof PHASES)[number];

export const Beat = Schema.Struct({
  /** When the chain last wrote this beat. */
  at: Schema.String,
  phase: Schema.Literals(PHASES),
  /** When the chain entered this phase. */
  since: Schema.String,
  /** When the step's agent last wrote to its event log; `null` before it wrote anything. */
  agentAt: Schema.NullOr(Schema.String),
});
export type Beat = typeof Beat.Type;

/** How often the chain writes the beat while nothing changes. */
export const EVERY = 30_000;

/**
 * How long a beat, or an agent in its turn, may stay quiet before `says` calls the lane stuck.
 * A guess, to tune from the beats themselves: the longest quiet part of a start we measured was
 * 100 to 180 s before the agent acted (ticket 673), and one box sweep took about 22 s (2026-11-11),
 * before the sweep left the start (0101).
 */
export const QUIET = 10 * 60_000;

/** The beat after entering `phase` at `now`: a new phase starts its own `since`. */
export const enter = (beat: Beat | null, phase: Phase, now: Date): Beat => ({
  at: now.toISOString(),
  phase,
  since: beat !== null && beat.phase === phase ? beat.since : now.toISOString(),
  agentAt: beat?.agentAt ?? null,
});

/** The beat written again at `now`, with when the agent last wrote, if it ever did. */
export const tick = (beat: Beat, now: Date, agentAt: Date | null): Beat => ({
  ...beat,
  at: now.toISOString(),
  agentAt: agentAt === null ? beat.agentAt : agentAt.toISOString(),
});

/** A span in the largest two units a person reads at a glance: `1h50m`, `12m`, `30s`. */
export const spoken = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);

  if (h > 0) {
    return `${h}h${String(m).padStart(2, "0")}m`;
  }

  return m > 0 ? `${m}m` : `${s}s`;
};

/**
 * The line a status page shows for a running lane, and whether it counts as stuck: the beat went
 * quiet (the chain is blocked or gone), or the agent wrote nothing for `quiet` in its turn.
 */
export const says = (beat: Beat, now: Date, quiet = QUIET): { stuck: boolean; text: string } => {
  const ago = (iso: string) => now.getTime() - Date.parse(iso);
  const head = `${beat.phase} for ${spoken(ago(beat.since))}`;

  if (ago(beat.at) > quiet) {
    return { stuck: true, text: `${head}, no beat for ${spoken(ago(beat.at))}: stuck` };
  }

  // In the agent's turn, its silence counts from its last output, or from the turn's start.
  const silent = Math.min(ago(beat.since), beat.agentAt === null ? Infinity : ago(beat.agentAt));

  if (beat.phase === "agent" && silent > quiet) {
    return { stuck: true, text: `${head}, no agent output for ${spoken(silent)}: stuck` };
  }

  const last = beat.agentAt === null ? null : spoken(ago(beat.agentAt));
  const agent = last === null ? "no agent output yet" : `last agent output ${last} ago`;
  return { stuck: false, text: `${head}, ${agent}` };
};
