import type {Sandbox} from "@kampus/fabrika";

// What is mounted in each stage's sandbox (a-ticket-runs-from-the-app.md,
// section 5). Every stage runs in a sandbox. Triage's mounts nothing and holds
// only the model credential; the coding stages' mount a worktree; review's and
// push's mount the commit, read only; merge's mounts nothing. A stage with no
// agent gets no credential. No sandbox holds the GitHub key: push's and
// merge's GitHub Cmds are done outside.

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

const SANDBOXES = {
	triage: {mount: "none", agent: true},
	plan: {mount: "worktree", agent: true},
	test_writer: {mount: "worktree", agent: true},
	build: {mount: "worktree", agent: true},
	mutation: {mount: "worktree", agent: false},
	review: {mount: "commit", agent: true},
	push: {mount: "commit", agent: false},
	merge: {mount: "none", agent: false},
} as const satisfies Record<Stage, {mount: Sandbox.Mount["_tag"]; agent: boolean}>;

/** Does this stage run an agent, and so take a model credential? */
export const hasAgent = (stage: Stage): boolean => SANDBOXES[stage].agent;

/**
 * The sandbox for one stage's job. `folder` is the worktree or the commit's
 * checkout; a stage that mounts nothing does not get it. `credential` is
 * dropped for a stage with no agent.
 */
export const sandboxFor = (
	stage: Stage,
	o: {readonly folder: string; readonly credential: Sandbox.Credential},
): Pick<Sandbox.Job, "mount" | "credential"> => {
	const {mount, agent} = SANDBOXES[stage];
	return {
		mount: mount === "none" ? {_tag: "none"} : {_tag: mount, folder: o.folder},
		credential: agent ? o.credential : {_tag: "none"},
	};
};
