import {DurableObject} from "cloudflare:workers";
import {type Appended, createLog, type Entry, type Line} from "./log.ts";

// The project object: the one ledger (D1, D2). Three calls. It handles one call at a time, so the
// numbers of a line are set in one step. `wait` is the doorbell: it answers as soon as a stream has
// something after the given rev.

export type Ledger = {
	append(stream: string, id: string, line: Line): Promise<Appended>;
	read(stream: string, after: number): Promise<readonly Entry[]>;
	wait(stream: string, after: number): Promise<number>;
};

/** Someone waiting on a stream: called with its new rev. */
type Bell = (rev: number) => void;

export class Project<Env> extends DurableObject<Env> implements Ledger {
	private readonly log = createLog(this.ctx.storage.sql);
	private readonly bells = new Map<string, Bell[]>();

	async append(stream: string, id: string, line: Line): Promise<Appended> {
		const appended = this.log.append(stream, id, line, new Date().toISOString());
		if (appended.fresh) {
			const waiting = this.bells.get(stream) ?? [];
			this.bells.delete(stream);
			for (const ring of waiting) ring(appended.rev);
		}
		return appended;
	}

	async read(stream: string, after: number): Promise<readonly Entry[]> {
		return this.log.read(stream, after);
	}

	async wait(stream: string, after: number): Promise<number> {
		const head = this.log.head(stream);
		if (head > after) return head;
		return new Promise((ring) => {
			this.bells.set(stream, [...(this.bells.get(stream) ?? []), ring]);
		});
	}
}
