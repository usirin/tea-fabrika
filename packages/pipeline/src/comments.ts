// Whether a comment on an issue or a pull request is a machine's, and so
// nobody's reply. The GitHub code host reads review threads with it; the old
// operator's issue thread (`wip/src/operator-live.ts`) reads replies with it.
// Lifted out of that file when the pipeline moved into `@kampus/fabrika`
// (experiment 103).

/**
 * Any hidden mark at all. Fabrika's own verbs and shells comment under the
 * same account a person replies from; a comment with a mark is a machine's,
 * whoever's name is on it.
 */
const MARKED = /<!--[\s\S]*?-->/;
/**
 * Fabrika 0.9.0's records on an issue that carry no hidden mark: each opens
 * with its keyword and a colon. A lane's claim is one, and every run posts
 * its own when it starts, after an earlier run's question: read as a reply,
 * it would go to the Judge as the owner's answer.
 */
const FABRIKA_RECORD =
	/^\s*(?:lane-(?:claim|adopt|record)|build-(?:claim|claim-override|adopt|deviations)|decision-ruling):/;
/** Whether a comment is a machine's, and so nobody's reply. */
export const isMachines = (body: string): boolean => MARKED.test(body) || FABRIKA_RECORD.test(body);
