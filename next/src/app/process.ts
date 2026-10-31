import {DurableObject} from "cloudflare:workers";
import {Schema} from "effect";
import {createMailbox, type Mailbox} from "../coordination/mailbox.ts";
import {createProcessManager} from "../coordination/process-manager.ts";
import type {Ledger} from "../data/project.ts";
import type {GatewayCalls} from "../transport/gateway.ts";
import {news} from "../transport/wire.ts";
import type {ProgramCalls} from "./entry.ts";
import {diff} from "./patch.ts";

// One running copy of a program, in its own object (A3). It holds no state of its own: on a wake it
// loads the program's code with Worker Loader and folds its inbox from the ledger. So a kill loses
// nothing that was acknowledged, and the view's revision is the inbox's `pos`.
//
//   msg({id: "m-17", m: {type: "plus", saw: 41}, by: "w-1", said: "..."})
//     the letter is saved, once         {stream: "counter:1/inbox", pos: 42, rev: 412}
//     the program steps                 {n: 41} -> {n: 42}
//     every window watching hears       {pid, rev: 42, patch: [...], ledger: 412}

/** A program as it ships with the brain: its name's code, keyed by its content's hash (A4). */
export type Built = {readonly hash: string; readonly code: string};

export type ProcessEnv = {
	readonly LOADER: WorkerLoader;
	readonly PROJECT: ObjectSpace<Ledger>;
	readonly GATEWAY: ObjectSpace<GatewayCalls>;
	readonly PROGRAMS: Readonly<Record<string, Built>>;
};

/** What a window hears: a whole copy at a revision (A3). */
export type Whole = {
	readonly pid: string;
	readonly rev: number;
	readonly whole: unknown;
	readonly ledger: number;
};

/** The answer to one Msg: where it landed, or why it did not. */
export type Sent =
	| {readonly rev: number; readonly pos: number; readonly ledger: number}
	| {readonly why: "no_program" | "bad_msg"};

export type ProcessCalls = {
	open(peer: string): Promise<{readonly why: "no_program"} | {readonly opened: string}>;
	msg(input: {
		readonly id: string;
		readonly m: unknown;
		readonly by: string;
		readonly said: string;
	}): Promise<Sent>;
};

const Letter = Schema.Struct({m: Schema.Unknown});
const decodeLetter = Schema.decodeUnknownSync(Letter);
const Peers = Schema.Array(Schema.String);
const decodePeers = Schema.decodeUnknownSync(Peers);

const WATCHERS = "watchers";

export const objectName = (pid: string): string => `process:${pid}`;

/** The pid's program: `counter:1` runs `counter`. */
const programName = (pid: string): string => pid.split(":")[0] ?? pid;

type Live = {
	readonly entry: ProgramCalls;
	readonly mail: Mailbox;
	model: unknown;
	view: unknown;
	/** The inbox's `pos` of the last letter folded: the view's revision. */
	rev: number;
	/** The ledger's `rev` of that letter: where the next read starts. */
	ledger: number;
};

export class Process<Env extends ProcessEnv> extends DurableObject<Env> implements ProcessCalls {
	private live: Live | null = null;
	private tail: Promise<unknown> = Promise.resolve();

	private get pid(): string {
		return (this.ctx.id.name ?? "").slice("process:".length);
	}

	/** One call at a time: an object call lets others in while it waits, and a fold must not mix. */
	private serial<A>(work: () => Promise<A>): Promise<A> {
		const run = this.tail.then(work, work);
		this.tail = run.catch(() => undefined);
		return run;
	}

	/** Wake: load the code, then fold the inbox. Null if the pid names no program. */
	private async wake(): Promise<Live | null> {
		if (this.live !== null) return this.live;
		const pid = this.pid;
		const program = programName(pid);
		const built = this.env.PROGRAMS[program];
		if (built === undefined) return null;
		const worker = this.env.LOADER.get(`${built.hash}:${pid}`, async () => ({
			compatibilityDate: "2026-07-01",
			mainModule: "program.js",
			modules: {"program.js": built.code},
			globalOutbound: null,
		}));
		const entry = worker.getEntrypoint<ProgramCalls>("Program");
		const ledger = this.env.PROJECT.getByName("project");
		await createProcessManager(ledger).start(pid, {program, hash: built.hash});
		const first = await entry.init();
		const live: Live = {
			entry,
			mail: createMailbox(ledger),
			model: first.model,
			view: first.view,
			rev: 0,
			ledger: 0,
		};
		await this.fold(live, false);
		this.live = live;
		return live;
	}

	/** Step through every letter after the last one folded, telling the watchers if `tell`. */
	private async fold(live: Live, tell: boolean): Promise<void> {
		for (const entry of await live.mail.receive(this.pid, live.ledger)) {
			const {m} = decodeLetter(entry.body);
			// New code may refuse an old letter. It cannot stop the wake: the letter counts for nothing
			// and the fold goes on, until dead letters come with the rest of C2.
			const next = await live.entry.step(live.model, m).catch(() => ({
				model: live.model,
				view: live.view,
			}));
			const patch = diff(live.view, next.view);
			live.model = next.model;
			live.view = next.view;
			live.rev = entry.pos;
			live.ledger = entry.rev;
			if (tell) {
				await this.tell(
					news("view.patch", {pid: this.pid, rev: live.rev, patch, ledger: live.ledger}),
				);
			}
		}
	}

	private watchers(): readonly string[] {
		const kept = this.ctx.storage.kv.get(WATCHERS);
		return kept === undefined ? [] : decodePeers(kept);
	}

	/** Tell every window watching, in order. A gateway with no socket left stops being one. */
	private async tell(text: string): Promise<void> {
		const peers = this.watchers();
		const heard = await Promise.all(
			peers.map((peer) => this.env.GATEWAY.getByName(`gateway:${peer}`).notify(text)),
		);
		const left = peers.filter((_, i) => heard[i]);
		if (left.length !== peers.length) this.ctx.storage.kv.put(WATCHERS, left);
	}

	/** A window starts watching: it gets a whole copy, then patches, in order. */
	open(peer: string): Promise<{readonly why: "no_program"} | {readonly opened: string}> {
		return this.serial(async () => {
			const live = await this.wake();
			if (live === null) return {why: "no_program"};
			await this.fold(live, true);
			const peers = this.watchers();
			if (!peers.includes(peer)) this.ctx.storage.kv.put(WATCHERS, [...peers, peer]);
			const whole: Whole = {pid: this.pid, rev: live.rev, whole: live.view, ledger: live.ledger};
			await this.env.GATEWAY.getByName(`gateway:${peer}`).notify(news("view.whole", whole));
			return {opened: this.pid};
		});
	}

	msg(input: {
		readonly id: string;
		readonly m: unknown;
		readonly by: string;
		readonly said: string;
	}): Promise<Sent> {
		return this.serial(async () => {
			const live = await this.wake();
			if (live === null) return {why: "no_program"};
			// Only a Msg the program takes goes in the log; nothing in the log may crash its reader.
			const taken = await live.entry.step(live.model, input.m).then(
				() => true,
				() => false,
			);
			if (!taken) return {why: "bad_msg"};
			const place = await live.mail.send(this.pid, input.id, input.m, {
				by: input.by,
				said: input.said,
			});
			await this.fold(live, true);
			return {rev: place.pos, pos: place.pos, ledger: place.rev};
		});
	}
}
