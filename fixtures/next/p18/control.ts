// Test entry only. The stage bundles this file instead of the production brain entry.
// Control is an internal binding. It is never dispatched by fetch or JSON-RPC.
export {Gateway, Process, RecordPart} from "../../../next/apps/fabrika/src/brain.ts";
import {Project as ProductionProject} from "../../../next/apps/fabrika/src/brain.ts";
import {ProcessManager, Start} from "@kampus/libfabrika/coordination";
import {Effect} from "effect";

export class Project extends ProductionProject {
	readonly p18StartCounters = (hash: string) =>
		this.runtime.runPromise(ProcessManager.use((manager) => Effect.forEach(
			Array.from({length: 16}, (_, n) => n + 1), (n) => manager.start(Start.cases.first.make({id: `p18-counter-${n}`, name: `p18counter:${n}`, code: {program: "counter", hash}}), {
				by: "SHA256:p18-trusted-control", for: "person_p18-test", seen: 0,
				parent: "p18-control", sentAt: "2026-11-08T00:00:00Z", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", build: "p18-test",
			}), {discard: true})));
	readonly p18Exit = (process: string, why: string) =>
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: test-only Durable Object RPC returns a Promise
		this.runtime.runPromise(ProcessManager.use((manager) => manager.exit(process, why, {
			by: "SHA256:p18-trusted-control", for: "person_p18-test", seen: 0,
			parent: "p18-control", sentAt: "2026-11-08T00:00:00Z",
			traceId: "4bf92f3577b34da6a3ce929d0e0e4736", build: "p18-test",
		})));

	readonly p18Wait = (client: string, session: string) => ({
		connections: Array.from(this.ctx.storage.sql.exec(
			"SELECT gateway FROM process_gateways WHERE client = ? AND session = ?", client, session)),
		rings: Array.from(this.ctx.storage.sql.exec(
			'SELECT "to", stream, after FROM rings WHERE stream = ?', `client:${client}/inbox`)),
	});
}
