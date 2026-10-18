import {Effect, Schema} from "effect";

// The one repository this repo's machines may write to: a private copy of a
// real one, made for live runs. Every write the build loop makes (a branch, a
// pull request, a comment, an enqueue) is held to it twice, and neither hold
// is a convention:
//
//   1. by shape: the build and operate programs take a ticket or a pull
//      request only as a url into this repository. Any other url does not
//      fit the input's schema, so the value is refused when it is decoded,
//      before a run starts or a service is made.
//   2. at the service: every write side the loop is given (./stages/build/
//      github.ts, `sandboxWrites` below) checks the url or repository it is
//      handed against this name first, and dies on any other. A write that
//      reached it from code that skipped the schema still writes nothing.
//
// Reads of other repositories are not held here: they change nothing.

/** The sandbox, as `<owner>/<name>`. */
export const SANDBOX = "usirin/tea-fabrika-sandbox";

/** Its address, as git and the browser take it. */
export const SANDBOX_URL = `https://github.com/${SANDBOX}`;

const escaped = SANDBOX.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/** A ticket in the sandbox: `https://github.com/<sandbox>/issues/<number>`, nothing else. */
export const SandboxTicket = Schema.String.check(
	Schema.isPattern(new RegExp(`^https://github\\.com/${escaped}/issues/[1-9]\\d*$`), {
		message: `not a ticket in the sandbox: this program writes to ${SANDBOX} only, so it takes https://github.com/${SANDBOX}/issues/<number> and no other repository`,
	}),
).annotate({description: `https://github.com/${SANDBOX}/issues/<number>`});

/** A pull request in the sandbox. */
export const SandboxPullRequest = Schema.String.check(
	Schema.isPattern(new RegExp(`^https://github\\.com/${escaped}/pull/[1-9]\\d*$`), {
		message: `not a pull request in the sandbox: this program writes to ${SANDBOX} only, so it takes https://github.com/${SANDBOX}/pull/<number> and no other repository`,
	}),
).annotate({description: `https://github.com/${SANDBOX}/pull/<number>`});

const ONE_OF_ITS = new RegExp(`^https://github\\.com/${escaped}/(?:issues|pull)/[1-9]\\d*$`);

/**
 * Whether a url is in the sandbox: the repository itself, or one of its
 * issues or pull requests, whole. Not "starts with the sandbox": a url with
 * another repository's address after it (`<sandbox>/x?https://github.com/
 * <other>/pull/1`) would pass that, and the readers that take a pull
 * request's repository out of a url find the last one.
 */
export const inSandbox = (url: string): boolean =>
	url === SANDBOX_URL || url === `${SANDBOX_URL}.git` || ONE_OF_ITS.test(url);

/** A ticket's number, from a url the schema took. */
export const numberOf = (url: string): number => Number(url.slice(url.lastIndexOf("/") + 1));

/**
 * The second hold: a write whose target is not in the sandbox dies, and
 * nothing is written. A die and not a failure: no caller can catch it and go
 * on, and a test sees it as a defect.
 */
export const sandboxOnly = (url: string): Effect.Effect<void> =>
	inSandbox(url)
		? Effect.void
		: Effect.die(
				new Error(`refused: ${url} is not in ${SANDBOX}, the only repository this writes to`),
			);
