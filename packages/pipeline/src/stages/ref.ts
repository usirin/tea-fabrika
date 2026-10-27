// A GitHub url, short. Its own file, with no imports, because the app's window reads it (through
// ./status.ts): a file that also held a stage machine would pull its agent and Node into the
// window's bundle.

/** A GitHub issue's or pull request's url, as `#123`. Anything else: `null`. */
export const refOf = (url: string): string | null => {
	const found = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/(\d+)/.exec(url);
	return found === null ? null : `#${found[1]}`;
};
