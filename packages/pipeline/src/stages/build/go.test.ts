import {describe, expect, it} from "vitest";
import type {AnswerBody} from "../../asks/ask.ts";
import {plans86b} from "../../asks/cases.ts";
import type {Entry, Fact} from "../../asks/ledger.ts";
import {foldLedger, planAskId} from "../../asks/rules.ts";
import {planOf, ticketId} from "../../ids.ts";
import {revisionOfDraft} from "../plan/plan.ts";
import {planStateIn} from "./go.ts";

// How a ticket's plan stands on the ledger, read for the build gate. Pure:
// a ledger is a list of facts, folded the way the asks core folds it.

const [first] = plans86b().filter((p) => p.plan !== null);
const ticket = ticketId(first!.ticket);
const plan = planOf(ticket);
const data = revisionOfDraft(first!.plan!);
if (data === null) throw new Error("the first 86b plan has no revision");
const planned: Fact = {type: "planned", plan, tickets: [ticket], data, problems: []};
const answered = (answer: AnswerBody): Fact => ({type: "answered", id: planAskId(plan, 1), answer});
const stateOf = (facts: readonly Fact[]) =>
	planStateIn(foldLedger(facts.map((fact, i): Entry => ({seq: i + 1, fact}))), ticket);

describe("a ticket's plan, as the build gate reads it", () => {
	it("no plan names the ticket: none", () => {
		expect(stateOf([])).toBe("none");
		expect(planStateIn(foldLedger([]), ticketId("acme/widgets#9"))).toBe("none");
	});

	it("a plan waiting on the owner is not approved", () => {
		expect(stateOf([planned])).toBe("not_approved");
	});

	it("the owner approved it: approved", () => {
		expect(stateOf([planned, answered({kind: "approve"})])).toBe("approved");
	});

	it("the owner said no: not approved, so nothing builds a closed plan", () => {
		expect(stateOf([planned, answered({kind: "no", why: "not now"})])).toBe("not_approved");
	});
});
