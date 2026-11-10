import {Schema} from "effect";
import {jsonSchemaOf} from "../program/shape.ts";
import type {Tool} from "./tools.ts";

// The `job` tool, beside `runs`: one job of the host's table, its state and its last lines, as
// tmux's `capture-pane -p -S -<n>` reads one pane and `docker logs --tail <n>` one container.
// Read-only. The host hands the job as it knows it, every line it kept; the door cuts them here
// (`lastLines`), so no answer passes `last` lines or `BYTES_MAX` bytes, whatever a job printed.
//
//   tile t1   tsh$ seq --to 5            job %1, prints 1 to 5, and ends done
//   agent     job {n: 1, last: 2}
//   //        {n: 1, text: "seq --to 5", tile: "t1", state: {_tag: "ended", how: "done"},
//   //         lines: ["4", "5"]}
//   agent     job {n: 99}                refused: "there is no job 99 ..."
//   agent     job {n: 1, last: 5000}     refused by the schema: the error names `last`
//
// The field is `last`, not `tail`: here "the tail" already means the ledger's live stream.
//
// The bytes are counted as the lines go out: UTF-8, one newline after each.

/** The tool's name. */
export const JOB = "job";

/**
 * The most bytes of lines one answer holds. Claude Code warns when one MCP tool's output passes
 * 10,000 tokens (code.claude.com/docs/en/mcp, read 2026-11-03), and a Claude token is about 3.5
 * English characters (Anthropic's glossary): about 35,000 bytes of ASCII. The answer is JSON,
 * two-space indented, so each line costs about 7 bytes more than it is counted here (its indent,
 * quotes, comma); 25,000 leaves room for `LAST_MAX` of them under 35,000.
 */
export const BYTES_MAX = 25_000;

/**
 * The most lines one answer holds, and so the most the host keeps of a job. tmux keeps 2,000 a
 * pane (its `history-limit`, tmux(1)); 1,000 lines at about 7 bytes of JSON each, beside
 * `BYTES_MAX`, keep the answer under 35,000 bytes.
 */
export const LAST_MAX = 1_000;

/** A line's bytes as it goes out: UTF-8, and its newline. A lone surrogate goes as U+FFFD, three bytes. */
const bytesOf = (line: string): number => {
	let n = 1;

	for (const ch of line) {
		const code = ch.codePointAt(0) ?? 0;
		n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}

	return n;
};

/** The start of `line` that goes out in at most `bytes`, newline included, cut between code points. */
const cutTo = (line: string, bytes: number): string => {
	let n = 1;
	let end = 0;

	for (const ch of line) {
		const size = bytesOf(ch) - 1;

		if (n + size > bytes) {
			break;
		}

		n += size;
		end += ch.length;
	}

	return line.slice(0, end);
};

/**
 * The newest `last` lines of `printed`, in order, as many as fit in `BYTES_MAX` bytes. It stops
 * where the next older line would not fit. A newest line too long alone shows its start, cut to
 * fit, as a terminal shows a line's start: a job that printed always shows it printed.
 */
export const lastLines = (printed: readonly string[], last: number): readonly string[] => {
	const out: string[] = [];
	let bytes = 0;

	for (let i = printed.length - 1; i >= 0 && out.length < last; i -= 1) {
		const line = printed[i] ?? "";
		const size = bytesOf(line);

		if (bytes + size > BYTES_MAX) {
			if (out.length === 0) {
				out.push(cutTo(line, BYTES_MAX));
			}

			break;
		}

		bytes += size;
		out.push(line);
	}

	return out.reverse();
};

/**
 * A job's lines as the host keeps them while it runs and a while after: the newest that any
 * answer could show, and no more, so a job that prints without end holds `BYTES_MAX` bytes at
 * most. `lastLines` of what is kept is `lastLines` of everything the job printed.
 */
export class KeptLines {
	readonly #lines: string[] = [];
	#bytes = 0;

	/** One more line the job printed. */
	push(text: string): void {
		const [line = ""] = lastLines([text], 1);
		this.#lines.push(line);
		this.#bytes += bytesOf(line);

		while (this.#lines.length > LAST_MAX || this.#bytes > BYTES_MAX) {
			this.#bytes -= bytesOf(this.#lines.shift() ?? "");
		}
	}

	get lines(): readonly string[] {
		return this.#lines;
	}
}

/** What the tool takes: the job's number, `%n` on a line, and how many of its last lines. */
export const JobAsk = Schema.Struct({
	n: Schema.Int,
	last: Schema.optionalKey(Schema.Int.check(Schema.isBetween({minimum: 1, maximum: LAST_MAX}))),
});
export type JobAsk = typeof JobAsk.Type;

/**
 * One job, as the tool answers it. `tile`: the tile whose tsh runs it, `null` for a job of no
 * tile. `state`: it runs; it is in the table but runs nowhere, from before the host started
 * again (`attach %n` starts it); or it ended, and how, as a job's record says it.
 */
export const JobAnswer = Schema.Struct({
	n: Schema.Int,
	text: Schema.String,
	tile: Schema.NullOr(Schema.String),
	state: Schema.TaggedUnion({
		running: {},
		detached: {},
		ended: {how: Schema.Literals(["done", "failed", "stopped"])},
	}),
	lines: Schema.Array(Schema.String),
});
export type JobAnswer = typeof JobAnswer.Type;

export const JOB_TOOL: Tool = {
	name: JOB,
	description: `One job of the host's table, by its number (%n on a line, as jobs and runs show it): its line as typed, its tile, whether it runs, is detached (from before the host started again) or ended and how, and its last lines, out and err, newest last. last: how many, ${LAST_MAX} at most; with none, as many as fit. Read-only.`,
	inputSchema: {...jsonSchemaOf(JobAsk), type: "object"},
	annotations: {readOnlyHint: true},
};
