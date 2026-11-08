/** The most characters a value's JSON takes on one line: a longer one is drawn indented. */
const ONE_LINE = 64;

/** A value's JSON on one line, when it fits there. `null`: longer than one line holds. */
export const oneLine = (value: unknown): string | null => {
	const one = JSON.stringify(value) ?? "undefined";
	return one.length <= ONE_LINE ? one : null;
};

/** A value as JSON: on one line when short, else indented. */
export const json = (value: unknown): string =>
	oneLine(value) ?? JSON.stringify(value, null, 2) ?? "undefined";
