import type {Sandbox} from "@kampus/fabrika";

// What each stage's box holds (a-ticket-runs-from-the-app.md, section 5).
// Every stage runs in a box. Triage's holds nothing but the model login; the
// coding stages' hold a copy of the code; review's and push's hold the commit,
// read only; merge's holds nothing. A stage with no agent gets no login. No
// box holds the GitHub key: push's and merge's GitHub Cmds are done outside.

/** Every stage of a lane, in the order a ticket meets them. */
export const STAGES = [
	"triage",
	"plan",
	"test_writer",
	"build",
	"mutation",
	"review",
	"push",
	"merge",
] as const;
export type Stage = (typeof STAGES)[number];

const BOXES = {
	triage: {holds: "nothing", agent: true},
	plan: {holds: "code", agent: true},
	test_writer: {holds: "code", agent: true},
	build: {holds: "code", agent: true},
	mutation: {holds: "code", agent: false},
	review: {holds: "commit", agent: true},
	push: {holds: "commit", agent: false},
	merge: {holds: "nothing", agent: false},
} as const satisfies Record<Stage, {holds: Sandbox.Holds["_tag"]; agent: boolean}>;

/** Does this stage run an agent, and so take a model login? */
export const hasAgent = (stage: Stage): boolean => BOXES[stage].agent;

/**
 * The box for one stage's job. `folder` is the copy of the code or the
 * commit's checkout; a stage whose box holds nothing does not get it. `login`
 * is dropped for a stage with no agent.
 */
export const boxOf = (
	stage: Stage,
	o: {readonly folder: string; readonly login: Sandbox.Login},
): Pick<Sandbox.Job, "holds" | "login"> => {
	const {holds, agent} = BOXES[stage];
	return {
		holds: holds === "nothing" ? {_tag: "nothing"} : {_tag: holds, folder: o.folder},
		login: agent ? o.login : {_tag: "none"},
	};
};
