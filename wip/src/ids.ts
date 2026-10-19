import {Id, make, read} from "./entity.ts";

// Every kind of id the ledger gives or takes, in one place: each a brand of
// its own (./entity.ts), so one kind's id is never taken for another's.
//
//   TicketId     o/r#7         a ticket on the code host, however it was written
//   PlanId       o/r#7         a plan, named by the first ticket it covers
//   StoryId      s1            a story of a plan, as the planner named it
//   TaskId       t1            a task of a plan, given by the plan's book
//   CriterionId  c3            a criterion, given by the plan's book
//   QuestionId   q2            an open question of a plan, given by the plan's versions
//   VerdictId    v12           a review's verdict on one criterion, given by the book
//   AskId        plan:o/r#7@2  a question to the owner; its one answer goes under it too
//   LaneId       L1            a run of the operate loop on one ticket
//
// A given id is a counter or a name, never a place in a list: a task put in
// before another moves no id.

/** A ticket: `owner/name#N`. Made from that or from the issue's url by `ticketId`. */
export const TicketId = Id("TicketId", /^[\w.-]+\/[\w.-]+#[1-9][0-9]*$/);
export type TicketId = typeof TicketId.Type;
const readTicket = read(TicketId);

/** A ticket's id from `owner/name#N` or its issue's url. `null`: it is neither. */
export function readTicketId(text: string): TicketId | null {
	const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/.exec(text.trim());
	return readTicket(url === null ? text.trim() : `${url[1]}/${url[2]}#${url[3]}`);
}

/** A ticket's id from `owner/name#N` or its issue's url. Throws on anything else. */
export function ticketId(text: string): TicketId {
	const id = readTicketId(text);
	if (id === null) throw new Error(`not a ticket: ${JSON.stringify(text)}`);
	return id;
}

/** A plan, named by the first ticket it covers. Only `planOf` makes one. */
export const PlanId = Id("PlanId", /^[\w.-]+\/[\w.-]+#[1-9][0-9]*$/);
export type PlanId = typeof PlanId.Type;
const makePlan = make(PlanId);
/** A plan's id from text, as a target or a log wrote it, or `null`: it is not one. */
export const readPlanId = read(PlanId);

/** The plan a ticket starts: named by it. */
export const planOf = (ticket: TicketId): PlanId => makePlan(ticket);

/** The ticket a plan is named by: the first it covers. */
export const ticketOf = (plan: PlanId): TicketId => ticketId(plan);

/** A story, as the planner named it: `s1`, or any short word. */
export const StoryId = Id("StoryId", /^[a-z0-9][\w-]*$/i);
export type StoryId = typeof StoryId.Type;
export const storyId = make(StoryId);
export const readStoryId = read(StoryId);

/** A task of a plan: `t1`, `t2`, ... Only the plan's book gives one. */
export const TaskId = Id("TaskId", /^t[1-9][0-9]*$/);
export type TaskId = typeof TaskId.Type;
export const taskId = make(TaskId);
export const readTaskId = read(TaskId);

/** A criterion: `c1`, `c2`, ... Only the book gives one (`added`); a place in a list never is one. */
export const CriterionId = Id("CriterionId", /^c[1-9][0-9]*$/);
export type CriterionId = typeof CriterionId.Type;
/** An id from its text, as a person or a log wrote it. Throws on anything the book could not have given. */
export const criterionId = make(CriterionId);
/** An id from text a person typed, or `null`: it is not one the book could have given. */
export const readCriterionId = read(CriterionId);

/** An open question of a plan: `q1`, `q2`, ... Given when a version first asks it, and never again in that plan. */
export const QuestionId = Id("QuestionId", /^q[1-9][0-9]*$/);
export type QuestionId = typeof QuestionId.Type;
export const questionId = make(QuestionId);

/** A verdict on one criterion: `v1`, `v2`, ... The book gives one to each row a review hands it. */
export const VerdictId = Id("VerdictId", /^v[1-9][0-9]*$/);
export type VerdictId = typeof VerdictId.Type;
export const verdictId = make(VerdictId);

/** A lane: `L1`, `L2`, ... One run of the operate loop on one ticket. The ledger has no lane facts yet: only the world model (../laws/world/lanes.ts) names lanes. */
export const LaneId = Id("LaneId", /^L[1-9][0-9]*$/);
export type LaneId = typeof LaneId.Type;
export const laneId = make(LaneId);

/**
 * A question to the owner: its kind, then what it is about. The same ask
 * always has the same id, so a second hearing of it is known. An ask takes
 * one answer, kept under the same id: the answer is the ask's, not a thing
 * of its own.
 */
export const AskId = Id("AskId", /^(plan|stuck|ruling|check):\S/);
export type AskId = typeof AskId.Type;
export const askId = make(AskId);
export const readAskId = read(AskId);
