import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {act, intentOf, keptAct} from "../../primitives.ts";
import {Post} from "../operate/machine.ts";
import {outcomesOf} from "../outcome.ts";

// The push step: after one review passed a local head, the head goes out. Nothing before this step
// leaves the machine. No agent sits inside it.
//
//   pushing   the branch, at exactly the head the review passed
//   opening   the pull request: the open one, or a new one
//   posting   the review's verdicts on it, at that head, so ship reads them
//   over      done, with the pull request. Each step is an Act, so a kill sends it again, and the
//             service finds its own first write
//
//   start {ask} -> pushing -> opening -> posting -> over, done {pr, head}

const outcomes = outcomesOf({
	done: {pr: Schema.String, head: Schema.String},
	send: {},
	ask: {},
	skip: [],
	stuck: ["push_failed", "open_failed", "post_failed"],
});
export const PushOutcome = outcomes.schema;
export type PushOutcome = typeof PushOutcome.Type;

export const PushAsk = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	/** The head the review passed. */
	head: Schema.String,
	title: Schema.String,
	body: Schema.String,
	posts: Schema.Array(Post),
});
export type PushAsk = typeof PushAsk.Type;

const PushIn = Schema.Struct({ticket: Schema.String, number: Schema.Finite, head: Schema.String});
const OpenIn = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	head: Schema.String,
	title: Schema.String,
	body: Schema.String,
});
const PostIn = Schema.Struct({pr: Schema.String, head: Schema.String, posts: Schema.Array(Post)});

export const pushHead = act("push_head", {input: PushIn, ok: Schema.Null, err: ["unknown"]});
export const openPull = act("push_open", {input: OpenIn, ok: Schema.String, err: ["unknown"]});
export const postReviews = act("push_post", {input: PostIn, ok: Schema.Null, err: ["unknown"]});
export type PushCmd =
	| ReturnType<typeof pushHead>
	| ReturnType<typeof openPull>
	| ReturnType<typeof postReviews>;

export const Push = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({phase: Schema.Literal("pushing"), ask: PushAsk, asked: keptAct(pushHead, PushIn)}),
	Schema.Struct({phase: Schema.Literal("opening"), ask: PushAsk, asked: keptAct(openPull, OpenIn)}),
	Schema.Struct({
		phase: Schema.Literal("posting"),
		ask: PushAsk,
		pr: Schema.String,
		asked: keptAct(postReviews, PostIn),
	}),
	Schema.Struct({phase: Schema.Literal("over"), ask: PushAsk, outcome: PushOutcome}),
]);
export type Push = typeof Push.Type;

export type PushMsg = {readonly type: "start"; readonly ask: PushAsk} | {readonly type: "resume"};

type Step = readonly [Push, readonly PushCmd[]];
const stay = (s: Push): Step => [s, []];
const at = (ask: PushAsk, step: string) => intentOf("push", ask.ticket, ask.head, step);
const stuck = (ask: PushAsk, why: "push_failed" | "open_failed" | "post_failed"): Step => [
	{phase: "over", ask, outcome: {kind: "stuck", why}},
	[],
];

export const push = defineMachine({
	types: {model: {} as Push, msg: {} as PushMsg, ctx: undefined},
	cmds: [pushHead, openPull, postReviews],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const {ticket, number, head} = m.ask;
			const asked = pushHead({ticket, number, head, intent: at(m.ask, "push")});
			return [{phase: "pushing", ask: m.ask, asked}, [asked]];
		},
		resume: (s): Step =>
			s.phase === "pushing" || s.phase === "opening" || s.phase === "posting"
				? [s, [s.asked]]
				: stay(s),
		push_head_ok: (s): Step => {
			if (s.phase !== "pushing") return stay(s);
			const {ticket, number, head, title, body} = s.ask;
			const asked = openPull({ticket, number, head, title, body, intent: at(s.ask, "open")});
			return [{phase: "opening", ask: s.ask, asked}, [asked]];
		},
		push_head_err: (s): Step => (s.phase === "pushing" ? stuck(s.ask, "push_failed") : stay(s)),
		push_open_ok: (s, m): Step => {
			if (s.phase !== "opening") return stay(s);
			const asked = postReviews({
				pr: m.value,
				head: s.ask.head,
				posts: s.ask.posts,
				intent: at(s.ask, "post"),
			});
			return [{phase: "posting", ask: s.ask, pr: m.value, asked}, [asked]];
		},
		push_open_err: (s): Step => (s.phase === "opening" ? stuck(s.ask, "open_failed") : stay(s)),
		push_post_ok: (s): Step =>
			s.phase === "posting"
				? [
						{
							phase: "over",
							ask: s.ask,
							outcome: {kind: "done", part: false, pr: s.pr, head: s.ask.head},
						},
						[],
					]
				: stay(s),
		push_post_err: (s): Step => (s.phase === "posting" ? stuck(s.ask, "post_failed") : stay(s)),
	},
});
