// Experiment 147's host stack: experiment 146's `Fabrika.Host` resource, unchanged and imported
// from there, in a stack made by a function so one long-lived process can deploy it with
// different inputs and no CLI.
//
//   yield* deploy({stack: hostStack({home, programs: ["counter"], ledger: "memory"}), stage: "s147"});
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {Host, type HostProps, HostProvider, Processes} from "../146-alchemy-everywhere/host.ts";

export const hostStack = (props: HostProps) =>
	Alchemy.Stack(
		"tf-exp-147-host",
		{
			providers: HostProvider().pipe(Layer.provide(Processes.node)),
			state: Alchemy.localState(),
		},
		Effect.gen(function* () {
			const host = yield* Host("laptop", props);
			return {pid: host.pid, socket: host.socket, reloads: host.reloads};
		}),
	);
