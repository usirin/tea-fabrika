import {Context, type Effect} from "effect";
import type {Page} from "./pages.ts";

// Where the owner reads the desk. The desk program hands a view each page as
// data and never knows where it goes. Two views come with the pack: plain
// markdown files (./markdown.ts) and a GitHub-comment stand-in
// (./comment.ts). Which one runs is the pack's own setting; the core never
// sees it.

/** A view that could not show a page, and why. */
export interface ViewFailed {
	readonly _tag: "view_failed";
	readonly why: string;
}

export class DeskView extends Context.Service<
	DeskView,
	{
		/** Show a page, in place of whatever this view showed for it before. */
		readonly show: (page: Page) => Effect.Effect<void, ViewFailed>;
	}
>()("DeskView") {}

export const viewFailed = (why: string): ViewFailed => ({_tag: "view_failed", why});
