// Keep what did not change. A value that crossed a process (the host's desk, a run's view) is all
// new objects, even where tea's update kept a reference: a `memo` compares references, so it never
// skips. `share(old, next)` answers a value equal to `next`, made of `old`'s objects wherever they
// are equal, and `old` itself when nothing changed.
//
//   const a = {tiles: [{id: "t1"}, {id: "t2"}], zoomed: null};
//   const b = share(a, {tiles: [{id: "t1"}, {id: "t3"}], zoomed: null});
//   b.tiles[0] === a.tiles[0]   // true: t1 did not change
//   b === a                     // false
//   share(a, structuredClone(a)) === a   // true
//
// For plain data only, as JSON or structured clone leaves it. Anything else is answered as new.

const isPlain = (v: object): v is Record<string, unknown> => {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

const shareList = (old: readonly unknown[], next: readonly unknown[]): readonly unknown[] => {
	const kept = next.map((item, i) => share(old[i], item));
	return kept.length === old.length && kept.every((item, i) => item === old[i]) ? old : kept;
};

const shareRecord = (
	old: Record<string, unknown>,
	next: Record<string, unknown>,
): Record<string, unknown> => {
	const keys = Object.keys(next);
	const kept: Record<string, unknown> = {};
	let same = keys.length === Object.keys(old).length;
	for (const key of keys) {
		const value = share(old[key], next[key]);
		kept[key] = value;
		if (value !== old[key] || !(key in old)) same = false;
	}
	return same ? old : kept;
};

const shareAny = (old: unknown, next: unknown): unknown => {
	if (Object.is(old, next)) return old;
	if (typeof old !== "object" || old === null || typeof next !== "object" || next === null)
		return next;
	if (Array.isArray(old) && Array.isArray(next)) return shareList(old, next);
	if (Array.isArray(old) || Array.isArray(next) || !isPlain(old) || !isPlain(next)) return next;
	return shareRecord(old, next);
};

/** `next`, made of `old`'s objects wherever they are equal. */
export function share<T>(old: unknown, next: T): T;
export function share(old: unknown, next: unknown): unknown {
	return shareAny(old, next);
}
