import type {Appended, Entry} from "../data/log.ts";
import type {Ledger} from "../data/project.ts";

// A name's inbox is a stream of the ledger: `counter:1/inbox`, the one open door (D6). Delivery is
// at least once (C2): a reader keeps its own place, and a resend is saved once by its id.
//
//   send("counter:1", "m-17", {type: "plus", saw: 41}, {by: "w-1", said: "..."})
//   receive("counter:1", 0)    every letter, each with its pos and rev

const inbox = (name: string): string => `${name}/inbox`;

export type Mailbox = {
	send(
		to: string,
		id: string,
		m: unknown,
		from: {readonly by: string; readonly said: string},
	): Promise<Appended>;
	receive(name: string, after: number): Promise<readonly Entry[]>;
};

export const createMailbox = (ledger: Ledger): Mailbox => ({
	send: (to, id, m, from) => ledger.append(inbox(to), id, {...from, kind: "send", body: {m}}),
	receive: (name, after) => ledger.read(inbox(name), after),
});
