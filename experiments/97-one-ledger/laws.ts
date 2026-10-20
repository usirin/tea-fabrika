// The new laws of the one ledger (experiment 97). Like 93's and 96's laws, which run here unchanged,
// each needs only a LedgerClient, so the same code runs against the Durable Object (in process, and
// as a child Miniflare across SIGKILLs), against node:sqlite, and against the ledger's SQL with one
// planted mistake, where it must fail.
//
//   16. an unfenced write under a claimed name is refused (`denied`), for ever, and so is a claim
//       that would reach inside another name;
//   17. an append to an inbox lands with no lease at all;
//   18. a reply into another program's inbox, fenced on the replier's own lease, lands while that
//       lease is live and is refused (`fenced`) once it is lost, a repeat of a landed reply too.
import type {LedgerClient} from "./client.ts";
import type {AppendResult, ClaimResult} from "./sql.ts";

export type LawResult = {law: string; pass: boolean; numbers: string};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
/** A fresh name per law, so laws never see each other's events. */
const fresh = (tag: string) => `${tag}-${Date.now().toString(36)}-${seq++}`;

const word = (r: AppendResult | ClaimResult) =>
	r.ok ? ("dup" in r && r.dup ? "dup" : "ok") : r.why;
/** Each step: what it did, what it got, what the law wants. */
type Step = {what: string; got: string; want: string};
const verdict = (law: string, steps: readonly Step[], extra = ""): LawResult => {
	const bad = steps.filter((s) => s.got !== s.want);
	return {
		law,
		pass: bad.length === 0,
		numbers:
			(bad.length === 0
				? steps.map((s) => `${s.what}: ${s.got}`).join("; ")
				: `WRONG ${bad.map((s) => `${s.what}: ${s.got}, wanted ${s.want}`).join("; ")}`) + extra,
	};
};

/** 16. Under a claimed name, only its lease's fence writes. The name stays claimed after the lease. */
export async function law16Guard(c: LedgerClient): Promise<LawResult> {
	const law = "16. an unfenced write under a claimed name is refused, live lease or not";
	const p = fresh("l16");
	const steps: Step[] = [];
	const step = (what: string, r: AppendResult | ClaimResult, want: string) =>
		steps.push({what, got: word(r), want});
	// Not claimed yet: the name is nobody's, so this lands (the hole this rule leaves; see the write-up).
	const before = await c.append(`${p}/notes`, "any", {kind: "note", writer: "x"});
	const c1 = await c.claim(p, "h1", 0, 800);
	if (!c1.ok) return {law, pass: false, numbers: `claim 1 ${c1.why}`};
	step(
		"unfenced state, lease live",
		await c.append(`${p}/state`, 0, {kind: "s", writer: "x"}),
		"denied",
	);
	step(
		"unfenced state at the end with an id",
		await c.append(`${p}/state`, "any", {kind: "s", writer: "x", id: "a"}),
		"denied",
	);
	step("unfenced to the name itself", await c.append(p, "any", {kind: "s", writer: "x"}), "denied");
	step("unfenced deeper", await c.append(`${p}/a/b`, "any", {kind: "s", writer: "x"}), "denied");
	step(
		"unfenced to a stream that existed before the claim",
		await c.append(`${p}/notes`, "any", {kind: "s", writer: "x"}),
		"denied",
	);
	step("fenced state", await c.append(`${p}/state`, 0, {kind: "s", writer: "h1"}, c1.fence), "ok");
	await sleep(1000);
	// The lease ran out and nobody has claimed: still the name's.
	step(
		"unfenced state after the lease ran out",
		await c.append(`${p}/state`, 1, {kind: "s", writer: "x"}),
		"denied",
	);
	const c2 = await c.claim(p, "h2", c1.rev, 30_000);
	// A reclaim at the claim's rev fails only if something unfenced got into the name's stream.
	step("reclaim at the name's last claim", c2, "ok");
	if (!c2.ok) return verdict(law, steps);
	step(
		"unfenced state after a reclaim",
		await c.append(`${p}/state`, 1, {kind: "s", writer: "x"}),
		"denied",
	);
	step("new fence", await c.append(`${p}/state`, 1, {kind: "s", writer: "h2"}, c2.fence), "ok");
	step("unfenced to a sibling", await c.append(`${p}0/state`, 0, {kind: "s", writer: "x"}), "ok");
	// A claim that would give a second lease reach over the name's streams.
	step("claim inside the name", await c.claim(`${p}/state`, "h3", 2, 30_000), "denied");
	step("claim of its inbox", await c.claim(`${p}/inbox`, "h3", 0, 30_000), "denied");
	const inner = await c.claim(`${p}-outer/inner`, "h4", 0, 30_000);
	step("claim of a name under an unclaimed one", inner, "ok");
	step("claim around a claimed name", await c.claim(`${p}-outer`, "h5", 0, 30_000), "denied");
	const rows = await c.readStream(`${p}/state`);
	steps.push({what: "state rows", got: String(rows.length), want: "2"});
	return verdict(law, steps, `; before any claim, unfenced ${p}/notes: ${word(before)}`);
}

/** 17. The mailbox is open: senders need no lease, and a repeated id is answered, not written. */
export async function law17Inbox(c: LedgerClient): Promise<LawResult> {
	const law = "17. an inbox append with no lease lands, under a claimed name";
	const p = fresh("l17");
	const inbox = `${p}/inbox`;
	const steps: Step[] = [];
	const step = (what: string, r: AppendResult | ClaimResult, want: string) =>
		steps.push({what, got: word(r), want});
	const c1 = await c.claim(p, "h1", 0, 600);
	if (!c1.ok) return {law, pass: false, numbers: `claim ${c1.why}`};
	step("send, lease live", await c.append(inbox, "any", {kind: "m", writer: "s", id: "m1"}), "ok");
	step(
		"the same id again",
		await c.append(inbox, "any", {kind: "m", writer: "s", id: "m1"}),
		"dup",
	);
	step("send with no id", await c.append(inbox, "any", {kind: "m", writer: "s"}), "ok");
	step("send at a rev", await c.append(inbox, 2, {kind: "m", writer: "s", id: "m2"}), "ok");
	step(
		"the owner, fenced, to its own inbox",
		await c.append(inbox, "any", {kind: "m", writer: "h1", id: "m3"}, c1.fence),
		"ok",
	);
	step(
		"an inbox of a name nobody claimed",
		await c.append(`${p}-new/inbox`, "any", {kind: "m", writer: "s", id: "m1"}),
		"ok",
	);
	await sleep(800);
	step(
		"send after the lease ran out",
		await c.append(inbox, "any", {kind: "m", writer: "s", id: "m4"}),
		"ok",
	);
	const rows = await c.readStream(inbox);
	steps.push({what: "inbox rows", got: String(rows.length), want: "5"});
	return verdict(law, steps);
}

/** 18. A fence reaches another program's inbox while its lease is live, and never after. */
export async function law18Reply(c: LedgerClient): Promise<LawResult> {
	const law =
		"18. a reply into another program's inbox, fenced on the replier's lease, is refused once that lease is lost";
	const a = fresh("l18-asker");
	const b = fresh("l18-answerer");
	const steps: Step[] = [];
	const step = (what: string, r: AppendResult | ClaimResult, want: string) =>
		steps.push({what, got: word(r), want});
	const ca = await c.claim(a, "ha", 0, 30_000);
	const cb = await c.claim(b, "hb", 0, 800);
	if (!ca.ok || !cb.ok) return {law, pass: false, numbers: "claims failed"};
	const reply = (id: string, fence: number) =>
		c.append(`${a}/inbox`, "any", {kind: "reply", writer: "hb", id}, fence);
	step("reply, lease live", await reply("r1", cb.fence), "ok");
	step(
		"the same fence into the asker's state",
		await c.append(`${a}/state`, "any", {kind: "s", writer: "hb"}, cb.fence),
		"fenced",
	);
	step(
		"the same fence into a stream that is no inbox",
		await c.append(`${b}x`, "any", {kind: "s", writer: "hb"}, cb.fence),
		"fenced",
	);
	await sleep(1000);
	step("reply after the lease ran out, nobody claimed", await reply("r2", cb.fence), "fenced");
	step("a repeat of the landed reply, lease lost", await reply("r1", cb.fence), "fenced");
	const cb2 = await c.claim(b, "hb2", cb.rev, 30_000);
	if (!cb2.ok) return {law, pass: false, numbers: `reclaim ${cb2.why}`};
	step("reply under the old fence after a reclaim", await reply("r3", cb.fence), "fenced");
	step("reply under the new fence", await reply("r3", cb2.fence), "ok");
	step(
		"a sender with no lease, same inbox",
		await c.append(`${a}/inbox`, "any", {kind: "ask", writer: "s", id: "q1"}),
		"ok",
	);
	const rows = await c.readStream(`${a}/inbox`);
	steps.push({what: "inbox rows", got: String(rows.length), want: "3"});
	return verdict(law, steps);
}

type NoDenied<T> = Exclude<T, {why: "denied"}>;
/** The client as 93's and 96's laws know it: they were written before `denied` existed. */
export type OldClient = Omit<LedgerClient, "append" | "claim" | "cancel"> & {
	append(...args: Parameters<LedgerClient["append"]>): Promise<NoDenied<AppendResult>>;
	claim(...args: Parameters<LedgerClient["claim"]>): Promise<NoDenied<ClaimResult>>;
	cancel(...args: Parameters<LedgerClient["cancel"]>): Promise<NoDenied<AppendResult>>;
};
/**
 * 93's and 96's laws run unchanged on this view of the client. Their every write lands outside a
 * claimed name or carries its fence, so none should ever meet `denied`; if one does, the law stops
 * with an error saying so, and the harness counts it as failed.
 */
export const oldClient = (c: LedgerClient): OldClient => {
	const no = <T extends {ok: boolean}>(what: string, r: T): NoDenied<T> => {
		if ("why" in r && r.why === "denied")
			throw new Error(
				`an old law met "denied" on ${what}: the guard reached a write it should not`,
			);
		return r as NoDenied<T>;
	};
	return {
		...c,
		append: async (stream, ...rest) => no(`append ${stream}`, await c.append(stream, ...rest)),
		claim: async (stream, ...rest) => no(`claim ${stream}`, await c.claim(stream, ...rest)),
		cancel: async (stream, ...rest) => no(`cancel ${stream}`, await c.cancel(stream, ...rest)),
	};
};

export const newLaws = async (c: LedgerClient): Promise<LawResult[]> => [
	await law16Guard(c),
	await law17Inbox(c),
	await law18Reply(c),
];
