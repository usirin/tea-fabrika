import {useRuntime} from "@demlik/tea/react";
// Two windows over the same count. Compiled by compile.mjs with the React Compiler.
import {useSyncExternalStore} from "react";

// Today's desk.tsx shape: a module object, a hook whose value is dropped.
export const store = {count: 0, version: 0, listeners: new Set()};
export const bump = () => {
	store.count += 1;
	store.version += 1;
	for (const listener of store.listeners) listener();
};
const subscribe = (listener) => {
	store.listeners.add(listener);
	return () => store.listeners.delete(listener);
};

export function Dropped() {
	useSyncExternalStore(subscribe, () => store.version);
	const n = store.count;
	return <span id="dropped">{n}</span>;
}

// Principle 4 with tea's hook: draw what the hook returns.
export function Drawn({rt}) {
	const [s] = useRuntime(rt);
	return <span id="drawn">{s.count}</span>;
}
