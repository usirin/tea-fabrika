import {run} from "@demlik/tea/effect";
// A sketch: tea 0.22's useMachine lifecycle, cut down, on the Effect engine.
// The run starts in the effect (never in render or useMemo), and stops only from
// useInsertionEffect's cleanup, which neither Strict Mode's drill nor <Activity> calls.
// Cut from 0.22: Subs keep running while hidden (0.22 pauses them through SubGate).
import {Effect, Fiber} from "effect";
import {useEffect, useInsertionEffect, useState, useSyncExternalStore} from "react";

export const mounted = {last: null};

class MountedEffectRun {
	constructor(machine, opts) {
		this.machine = machine;
		this.opts = opts;
		this.snapshot = machine.init(null, opts.ctx)[0];
		this.listeners = new Set();
		this.fiber = null;
		this.rt = null;
		this.retired = false;
		this.held = [];
		this.starts = 0;
	}
	getSnapshot = () => this.snapshot;
	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	publish(state) {
		this.snapshot = state;
		for (const listener of this.listeners) listener();
	}
	/** The click: fire the Effect, no Promise. Held until boot, refused once retired. */
	dispatch = (msg) => {
		if (this.retired) return;
		if (this.rt !== null) Effect.runFork(this.rt.dispatch(msg));
		else this.held.push(msg);
	};
	connect() {
		if (this.fiber !== null || this.retired) return;
		this.starts += 1;
		const self = this;
		this.fiber = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					const booting = yield* run(self.machine, self.opts);
					const rt = yield* booting.ready;
					self.rt = rt;
					const unlisten = rt.subscribe(() => self.publish(rt.getState()));
					yield* Effect.addFinalizer(() => Effect.sync(unlisten));
					self.publish(rt.getState());
					for (const msg of self.held.splice(0)) Effect.runFork(rt.dispatch(msg));
					return yield* Effect.never;
				}),
			),
		);
	}
	/** Gone for good: close the Scope, which stops the run. */
	retire() {
		this.retired = true;
		const fiber = this.fiber;
		this.fiber = null;
		if (fiber !== null) Effect.runFork(Fiber.interrupt(fiber));
	}
}

export function useEffectMachine(machine, opts) {
	const [m] = useState(() => new MountedEffectRun(machine, opts));
	mounted.last = m;
	useInsertionEffect(() => () => m.retire(), [m]);
	useEffect(() => m.connect(), [m]);
	const state = useSyncExternalStore(m.subscribe, m.getSnapshot, m.getSnapshot);
	return [state, m.dispatch];
}
