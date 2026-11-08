import {readFileSync} from "node:fs";
// Today's version. Historical ids and questions come from experiment 196.
// The source is cases.json. It reconstructs ticket 117; it is not a historical ledger dump.
// Made up: plan contents, effects, repository, recs, prices, clocks, trace and replacement ids.
type PickRec = {_tag: "pick"; pick: string; why: string; cost: string; sure: number | null};
type Plan = {summary: string; stories: readonly unknown[]; tasks: readonly unknown[]; pointers: readonly unknown[]; questions: readonly unknown[]};
type Draft = {ask: string; for: string; step: string; repo: string; why: string | null; what: string; picks: readonly {pick: string; does: string}[]; rec: PickRec; ticket: {title: string; body: string}; evidence: {_tag: string; version: number; plan: Plan}; until: number | null};
type Data = {
 NOW: number; TRACE: string; HEAD: string; OTHER_HEAD: string;
 OWNER: {kind: "user"; id: string}; AGENT: {kind: "agent"; id: string; for: string};
 FILED: {type: "filed"; title: string; body: string}; PLAN: Plan; REC: PickRec;
 NONE: {_tag: "none"; why: string}; PICKS: Draft["picks"]; DRAFT: Draft;
 TOOK: {key: string; rec: string; ms: number; opened: readonly string[]; said: number};
 LEGACY_ASK: {type: "asked"; ask: string; what: string; picks: readonly string[]; trace: string};
 LEGACY_ANSWER: {type: "answered"; ask: string; pick: string; note: string; text: string};
 LEGACY_FACTS: readonly {readonly type: string; readonly [key: string]: unknown}[];
 CANONICAL_INPUT: unknown; CANONICAL_TEXT: string;
};
const data: Data = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
export const {NOW, TRACE, HEAD, OTHER_HEAD, OWNER, AGENT, FILED, PLAN, REC, NONE, PICKS, DRAFT, TOOK, LEGACY_ASK, LEGACY_ANSWER, LEGACY_FACTS, CANONICAL_INPUT, CANONICAL_TEXT} = data;
export type Sealed = {
 readonly type: "asked"; readonly format: 1; readonly ask: string;
 readonly for: string; readonly step: string; readonly repo: string;
 readonly why: string | null; readonly rec: unknown; readonly until: number | null;
 readonly shows: {readonly what: string; readonly picks: readonly {readonly pick: string; readonly does: string}[]; readonly rec: unknown; readonly ticket: unknown; readonly evidence: unknown};
 readonly saw: string; readonly blind: {readonly policy: number; readonly hidden: boolean};
 readonly replaces?: string;
};
// Find real policy seeds. No test overrides a sealed draw.
export const policyFor = (ask: string, hidden: boolean, draw: (ask: string, seed: number, policy: number) => {hidden: boolean}) => {
 for (let seed = 119120; seed < 120120; seed++) if (draw(ask, seed, 1).hidden === hidden) return {seed};
 throw new Error(`no ${hidden ? "hidden" : "shown"} draw in 1000 seeds`);
};
