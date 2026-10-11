import { isAbsolute, relative } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { defineMachine, type Sub } from "@demlik/tea";

// A spike (experiments/43-agent-sdk-stream.md): watch a running Claude Agent SDK
// query from a tea machine, and stop it when a rule trips. The query is a Sub,
// not a Cmd: a Cmd holds the fold until it settles, so a run inside one could
// not be judged while it runs. Every SDK message the Sub sees comes in as Msgs;
// the machine keeps a running picture and judges each one. Stopping is the
// Elm way: the state leaves `running`, the Sub's deps go null, and the engine
// closes the runner, which interrupts the query. Nothing here wires into the lane.

/** What the judge holds the run to. */
export interface Rules {
  /** The files the agent may write or edit, relative to its folder. `null`: any. */
  readonly allowed: readonly string[] | null;
  /** How many times in a row the same Bash command may fail before the run is stopped. */
  readonly repeats: number;
}

/** One run: what the Sub needs to open the query. */
export interface Run {
  readonly id: string;
  readonly prompt: string;
  /** The conversation's id, picked before the run starts. */
  readonly session: string;
  readonly rules: Rules;
}

/** One tool call as the agent asked for it. */
export interface Call {
  readonly id: string;
  readonly tool: string;
  /** The file a write or an edit is aimed at, relative to the folder when it is inside. */
  readonly file: string | null;
  /** A Bash call's command. */
  readonly command: string | null;
}

/** The last Bash command and how many times in a row it has failed. */
export interface Streak {
  readonly command: string;
  readonly failures: number;
}

/** What the machine knows about the run so far. */
export interface Picture {
  readonly calls: number;
  /** Files the agent asked to write or edit, first ask first. */
  readonly touched: readonly string[];
  /** Bash commands it ran, in order. */
  readonly commands: readonly string[];
  /** Calls whose results have not come back, by id. */
  readonly pending: Readonly<Record<string, Call>>;
  readonly streak: Streak | null;
}

export type Verdict =
  | { readonly kind: "outside_allowed"; readonly file: string }
  | { readonly kind: "repeated_failure"; readonly command: string; readonly times: number };

/** How the query ended on its own: its result message, cut to what a parent reads. */
export interface Finish {
  readonly subtype: string;
  readonly isError: boolean;
  readonly costUsd: number;
  readonly turns: number;
  readonly durationMs: number;
  readonly session: string;
  readonly denials: number;
}

export type Watch =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly run: Run; readonly picture: Picture }
  | { readonly phase: "stopped"; readonly run: Run; readonly picture: Picture; readonly verdict: Verdict }
  | { readonly phase: "finished"; readonly run: Run; readonly picture: Picture; readonly finish: Finish }
  | { readonly phase: "failed"; readonly run: Run; readonly picture: Picture; readonly error: string };

export type WatchMsg =
  | { readonly type: "start"; readonly run: Run }
  | ({ readonly type: "tool_called" } & Call)
  | { readonly type: "tool_returned"; readonly id: string; readonly failed: boolean }
  | ({ readonly type: "finished" } & Finish)
  | { readonly type: "ended"; readonly error: string };

/** The Sub that holds the query open while the run is live. */
export type AgentSub = Sub<"agent", { readonly id: string; readonly prompt: string; readonly session: string }>;

const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const emptyPicture: Picture = { calls: 0, touched: [], commands: [], pending: {}, streak: null };

/** Fold one call into the picture. */
export function seeCall(p: Picture, call: Call): Picture {
  return {
    ...p,
    calls: p.calls + 1,
    touched:
      call.file === null || !WRITES.has(call.tool) || p.touched.includes(call.file) ? p.touched : [...p.touched, call.file],
    commands: call.command === null ? p.commands : [...p.commands, call.command],
    pending: { ...p.pending, [call.id]: call },
  };
}

/**
 * Fold one result into the picture. Only Bash results move the streak: a read
 * between two tries of the same command does not break "in a row"; a
 * different command, or the same one passing, does.
 */
export function seeResult(p: Picture, id: string, failed: boolean): Picture {
  const call = p.pending[id];
  const { [id]: _, ...pending } = p.pending;
  if (call?.command == null) return { ...p, pending };
  const streak = !failed
    ? null
    : p.streak?.command === call.command
      ? { command: call.command, failures: p.streak.failures + 1 }
      : { command: call.command, failures: 1 };
  return { ...p, pending, streak };
}

/** The rule a call breaks as it is asked for, before it runs. */
export function judgeCall(rules: Rules, call: Call): Verdict | null {
  if (rules.allowed === null || call.file === null || !WRITES.has(call.tool)) return null;
  return rules.allowed.includes(call.file) ? null : { kind: "outside_allowed", file: call.file };
}

/** The rule the picture breaks once a result is in. */
export function judgePicture(rules: Rules, p: Picture): Verdict | null {
  return p.streak !== null && p.streak.failures >= rules.repeats
    ? { kind: "repeated_failure", command: p.streak.command, times: p.streak.failures }
    : null;
}

type Step = readonly [Watch, readonly never[]];
const stay = (s: Watch): Step => [s, []];

/** Go on with a new picture, or stop the run on a verdict. */
const judged = (run: Run, picture: Picture, verdict: Verdict | null): Step =>
  verdict === null ? [{ phase: "running", run, picture }, []] : [{ phase: "stopped", run, picture, verdict }, []];

export const watch = defineMachine({
  types: { model: {} as Watch, msg: {} as WatchMsg, sub: {} as AgentSub, ctx: undefined },
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => (s.phase === "idle" ? [{ phase: "running", run: m.run, picture: emptyPicture }, []] : stay(s)),
    tool_called: (s, m): Step => {
      if (s.phase !== "running") return stay(s);
      const call: Call = { id: m.id, tool: m.tool, file: m.file, command: m.command };
      return judged(s.run, seeCall(s.picture, call), judgeCall(s.run.rules, call));
    },
    tool_returned: (s, m): Step => {
      if (s.phase !== "running") return stay(s);
      const picture = seeResult(s.picture, m.id, m.failed);
      return judged(s.run, picture, judgePicture(s.run.rules, picture));
    },
    finished: (s, m): Step => {
      if (s.phase !== "running") return stay(s);
      const { type: _, ...finish } = m;
      return [{ phase: "finished", run: s.run, picture: s.picture, finish }, []];
    },
    ended: (s, m): Step =>
      s.phase === "running" ? [{ phase: "failed", run: s.run, picture: s.picture, error: m.error }, []] : stay(s),
  },
  subs: [
    {
      type: "agent",
      deps: (s: Watch) =>
        s.phase === "running" ? { id: s.run.id, prompt: s.run.prompt, session: s.run.session } : null,
    },
  ],
});

/** A path as the judge reads it: relative to the folder when inside it. */
const local = (cwd: string, path: string): string => {
  const rel = relative(cwd, path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The Msgs one SDK message carries. `cwd` is the folder the query runs in, as the SDK reports paths. */
export function msgsOf(message: SDKMessage, cwd: string): WatchMsg[] {
  if (message.type === "assistant" && message.parent_tool_use_id === null) {
    return message.message.content.flatMap((block): WatchMsg[] => {
      if (block.type !== "tool_use") return [];
      const input = (block.input ?? {}) as Record<string, unknown>;
      const path = text(input.file_path) ?? text(input.notebook_path);
      return [
        {
          type: "tool_called",
          id: block.id,
          tool: block.name,
          file: path === null ? null : local(cwd, path),
          command: block.name === "Bash" ? text(input.command) : null,
        },
      ];
    });
  }
  if (message.type === "user" && message.parent_tool_use_id === null && Array.isArray(message.message.content)) {
    return message.message.content.flatMap((block): WatchMsg[] =>
      block.type === "tool_result" ? [{ type: "tool_returned", id: block.tool_use_id, failed: block.is_error === true }] : [],
    );
  }
  if (message.type === "result") {
    return [
      {
        type: "finished",
        subtype: message.subtype,
        isError: message.is_error,
        costUsd: message.total_cost_usd,
        turns: message.num_turns,
        durationMs: message.duration_ms,
        session: message.session_id,
        denials: message.permission_denials.length,
      },
    ];
  }
  return [];
}
