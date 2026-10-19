import * as NodeServices from "@effect/platform-node/NodeServices";
import type {AnyRun} from "@tea-fabrika/tea-program";
import {memoryStorage, type Storage} from "@tea-fabrika/tea-program/storage";
import type {AnswerBody} from "@tea-fabrika/wip/asks/ask";
import {changed, numberOf, plans86b, RULINGS} from "@tea-fabrika/wip/asks/cases";
import {type Fact, memoryLedger} from "@tea-fabrika/wip/asks/ledger";
import {loadPacks, startWithPacks, type Wired} from "@tea-fabrika/wip/asks/packs";
import {asksProgram} from "@tea-fabrika/wip/asks/program";
import {
	checkId,
	criteriaOf,
	foldLedger,
	openAsks,
	planAskId,
	rulingId,
	stuckId,
} from "@tea-fabrika/wip/asks/rules";
import {type PlanId, planOf, taskId, ticketId} from "@tea-fabrika/wip/ids";
import {numbered} from "@tea-fabrika/wip/stages/plan/ids";
import {criteriaIn} from "@tea-fabrika/wip/stages/plan/lines";
import {revisionOfDraft} from "@tea-fabrika/wip/stages/plan/plan";
import {CONFIG_FILE, readConfig} from "@tea-fabrika/wip/tsh/config";
import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it} from "vitest";
import {DESK, markerOf, threadOf} from "./comment.ts";
import {fileOf} from "./markdown.ts";
import {answerOf} from "./reply.ts";

// The desk end to end, as a host runs it: a tsh.toml with the one `packs`
// line, the packs found by name from the config's folder, the core (the asks
// program) started with them, and the owner answering by typed replies. The
// core is the same in every test; only the config changes.
//
// The cases are real: the six plans experiment 86b wrote, one of them changed
// after its approval; a stuck task answered "keep going 3"; the rulings
// experiment 88's sort sent to the owner, #68 answered with each branch.

const DESK_PACK = "@tea-fabrika/owner-desk";
const LOG_PACK = "@tea-fabrika/ask-log";
/** Named in config only: nothing in this pack imports it. */
const UI_PACK = "@tea-fabrika/ui-verification";
type View = "markdown" | "comment";

/** The config a project writes: the one line, and each pack's own table. */
const tomlOf = (folder: string, packs: readonly string[], view: View = "markdown") =>
	[
		`packs = [${packs.map((p) => JSON.stringify(p)).join(", ")}]`,
		"",
		`[pack."${DESK_PACK}"]`,
		`view = "${view}"`,
		`dir = ${JSON.stringify(`${folder}/desk`)}`,
		"",
		`[pack."${LOG_PACK}"]`,
		`file = ${JSON.stringify(`${folder}/asks.log`)}`,
		"",
	].join("\n");

/** A project folder with the workspace's packages installed in it, as a project that added the packs would have. */
const project = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const folder = yield* fs.makeTempDirectoryScoped();
	const root = yield* path.fromFileUrl(new URL("../../../", import.meta.url));
	yield* fs.symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"));
	return folder;
});

interface Host {
	readonly wired: Wired;
	readonly core: AnyRun;
	/** The owner types a reply on the desk. */
	readonly reply: (id: string, text: string) => void;
}

/** Start the core and whatever packs the config names, as `tsh` would. */
const host = (folder: string, toml: string, storage: Storage) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const file = `${folder}/${CONFIG_FILE}`;
		yield* fs.writeFileString(file, toml);
		const config = yield* readConfig(file, {home: folder, user: folder});
		const packs = yield* loadPacks(config.packs, folder);
		const wired = yield* startWithPacks(
			{program: asksProgram, flags: {}},
			packs,
			config.pack,
			storage,
			{id: "asks"},
			{places: (name) => ({folder, home: `${folder}/packs/${name}`})},
		);
		const desk = wired.packs.find((p) => p.name === DESK_PACK);
		return {
			wired,
			core: wired.core.run as AnyRun,
			reply: (id, text) => typed(desk?.running.run as AnyRun | undefined, id, text),
		} satisfies Host;
	});

/** The owner types `text` on the desk, under the ask `id`. */
function typed(desk: AnyRun | undefined, id: string, text: string): void {
	const answer = answerOf(text);
	if (answer === null) throw new Error(`not an answer: ${text}`);
	if (desk === undefined) throw new Error("the desk is not enabled");
	desk.tell("reply", {id, answer});
}

const stopAll = (h: Host) =>
	Effect.gen(function* () {
		yield* h.wired.core.stop;
		for (const p of h.wired.packs) yield* p.running.stop;
	});

/** Wait until `check` holds; fail, saying `what`, after ten seconds (the whole suite runs side by side). */
const until = <E, R>(what: string, check: Effect.Effect<boolean, E, R>) =>
	Effect.gen(function* () {
		while (!(yield* check)) yield* Effect.sleep("5 millis");
	}).pipe(
		Effect.timeout("10 seconds"),
		Effect.catchTag("TimeoutError", () => Effect.die(new Error(`timed out waiting for ${what}`))),
	);

/** The ids the desk's inbox shows, top to bottom, read back from what the view wrote. */
const inboxIds = (folder: string, view: View) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = `${folder}/desk`;
		if (view === "markdown") {
			const file = `${dir}/inbox.md`;
			if (!(yield* fs.exists(file))) return [];
			return (yield* fs.readFileString(file))
				.split("\n")
				.filter((line) => /^\d+\. /.test(line))
				.map((line) => /\(`([^`]+)`/.exec(line)?.[1] ?? "");
		}
		const thread = yield* threadOf(dir, DESK);
		const body = thread.find((c) => c.marker === markerOf("inbox"))?.body ?? "";
		return body
			.split("\n")
			.filter((line) => line.startsWith("- [ ]"))
			.map((line) => /\(`([^`]+)`\)$/.exec(line)?.[1] ?? "");
	});

/** What the view shows for one ask. */
const pageOf = (folder: string, view: View, id: string, where: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		if (view === "markdown") return yield* fs.readFileString(`${folder}/desk/${fileOf(id)}`);
		const thread = yield* threadOf(`${folder}/desk`, where);
		return thread.find((c) => c.marker === markerOf(id))?.body ?? "";
	});

/** Wait until the page for one ask says `text`. */
const pageSays = (folder: string, view: View, id: string, where: string, text: string) =>
	until(
		`the page of ${id} to say ${text}`,
		pageOf(folder, view, id, where).pipe(
			Effect.map((page) => page.includes(text)),
			Effect.orElseSucceed(() => false),
		),
	);

const openIds = (disk: ReturnType<typeof memoryLedger>) =>
	openAsks(foldLedger(disk.read())).map((a) => a.id);
const answeredCount = (disk: ReturnType<typeof memoryLedger>) =>
	disk.read().filter((e) => e.fact.type === "answered").length;

const shows = (folder: string, view: View, ids: () => readonly string[]) =>
	until(
		`the desk to show ${ids().length} asks`,
		Effect.map(inboxIds(folder, view), (shown) => JSON.stringify(shown) === JSON.stringify(ids())),
	).pipe(
		Effect.catchDefect((defect) =>
			Effect.flatMap(inboxIds(folder, view), (shown) =>
				Effect.die(new Error(`${String(defect)}; it shows ${shown.length}: ${shown.join(", ")}`)),
			),
		),
	);

const run = <A, E>(body: (disk: ReturnType<typeof memoryLedger>) => Effect.Effect<A, E, any>) => {
	const disk = memoryLedger();
	return Effect.runPromise(
		body(disk).pipe(
			Effect.scoped,
			Effect.provide(disk.layer),
			Effect.provide(NodeServices.layer),
			Effect.timeout("60 seconds"),
		) as Effect.Effect<A>,
	);
};

/** A ticket's plan, by the ticket's name: where its asks are shown. */
const nameOf = (url: string): PlanId => planOf(ticketId(url));
const planId = (url: string, version: number) => planAskId(nameOf(url), version);
const urlOf = (n: string) => plans86b().find((p) => numberOf(p.ticket) === n)?.ticket ?? n;
const T1 = taskId("t1");

/**
 * The six 86b plans, through the desk: each shown, five approved and one
 * refused by the owner, then 565 changed after its approval and shown as only
 * what changed, and a line of it changed by the owner. Answers the ledger's
 * facts, for the view swap.
 */
const sixPlans = (view: View) =>
	run((disk) =>
		Effect.gen(function* () {
			const folder = yield* project;
			const h = yield* host(folder, tomlOf(folder, [DESK_PACK, LOG_PACK], view), memoryStorage());
			const plans = plans86b();
			for (const p of plans) h.core.tell("planned", p);
			const ids = plans.map((p) => planId(p.ticket, 1));
			yield* shows(folder, view, () => ids);

			// One view per plan: its stories, each criterion with the story it serves, its tasks, its questions with the lean.
			const p393 = yield* pageOf(folder, view, planId(urlOf("393"), 1), nameOf(urlOf("393")));
			expect(p393).toMatch(/s1\W+As /);
			expect(p393).toMatch(/c1\W.*\(serves s\d/);
			expect(p393).toMatch(/t1\W/);
			expect(p393.match(/Lean: /g)).toHaveLength(3);
			// 504's Check found problems: it still goes to the owner, problems shown.
			const p504 = yield* pageOf(folder, view, planId(urlOf("504"), 1), nameOf(urlOf("504")));
			expect(p504).toContain("Check still found");

			for (const n of ["367", "393", "490", "579", "565"]) h.reply(planId(urlOf(n), 1), "/approve");
			h.reply(planId(urlOf("504"), 1), "/no not now: its own Check still finds unchecked criteria");
			yield* shows(folder, view, () => []);
			expect(answeredCount(disk)).toBe(6);

			const p565 = plans.find((p) => numberOf(p.ticket) === "565");
			const first565 = p565?.plan == null ? null : revisionOfDraft(p565.plan);
			if (p565 === undefined || first565 === null)
				return yield* Effect.die(new Error("no plan 565"));
			// The code that changes it holds the approved version, ids and all: the
			// same ids the core gave, as the same plan gives the same ids on any replay.
			const v1 = numbered(first565);
			const added = `c${criteriaIn(v1).length + 1}`;
			const at = nameOf(p565.ticket);
			h.core.tell("revised", {plan: at, data: changed(v1)});
			const v2 = planId(p565.ticket, 2);
			yield* shows(folder, view, () => [v2]);
			const page = yield* pageOf(folder, view, v2, at);
			// Only what changed: the tightened criterion, the new one, the settled question. No story is shown again.
			expect(page).toMatch(/[Cc]hanged since v(ersion )?1/);
			expect(page).toContain(added);
			// The tightened one keeps its id: c2, the first after task 1's job.
			expect(page).toMatch(/\bc2\W+(\*\*said again:\*\* )?When /);
			expect(page).not.toMatch(/\bs1\W+As /);

			h.reply(v2, `/change ${added} the list stays sorted when the suite runs a second time`);
			yield* shows(folder, view, () => []);
			yield* until(
				"the change to be kept",
				Effect.sync(() => answeredCount(disk) === 7),
			);
			const closed = yield* pageOf(folder, view, v2, at);
			expect(closed).toContain(`change ${added}`);

			// The second pack heard the same, and the core knew neither.
			const fs = yield* FileSystem.FileSystem;
			yield* until(
				"the log to have every ask and answer",
				Effect.map(
					fs.readFileString(`${folder}/asks.log`).pipe(Effect.orElseSucceed(() => "")),
					(log) => log.split("\n").filter((l) => l !== "").length === 14,
				),
			);
			yield* stopAll(h);
			return disk.read().map((e): Fact => e.fact);
		}),
	);

/** Each test waits on files the packs write, side by side with the whole suite. */
const SLOW = {timeout: 30_000};

describe("the owner's desk, wired from one config line", SLOW, () => {
	it("the six 86b plans as approvals on markdown, one changed after approval shown as only what changed", async () => {
		const facts = await sixPlans("markdown");
		expect(facts.filter((f) => f.type === "answered").map((f) => f.answer.kind)).toEqual([
			"approve",
			"approve",
			"approve",
			"approve",
			"approve",
			"no",
			"change",
		]);
	});

	it("the same answers on the comment stand-in leave the same ledger: the view swaps, the core does not change", async () => {
		const [md, comment] = [await sixPlans("markdown"), await sixPlans("comment")];
		expect(comment).toEqual(md);
	});

	it("a stuck task answered keep going 3: counted from review rounds after the answer, out of rounds it asks again", async () => {
		await run((disk) =>
			Effect.gen(function* () {
				const folder = yield* project;
				const view = "comment";
				const h = yield* host(folder, tomlOf(folder, [DESK_PACK, LOG_PACK], view), memoryStorage());
				const plans = plans86b();
				for (const p of plans) h.core.tell("planned", p);
				yield* shows(folder, view, () => plans.map((p) => planId(p.ticket, 1)));
				for (const p of plans) h.reply(planId(p.ticket, 1), "/approve");
				yield* until(
					"six approvals",
					Effect.sync(() => answeredCount(disk) === 6),
				);

				const plan = nameOf(urlOf("367"));
				for (const open of [4, 3, 3, 3]) h.core.tell("reviewed", {plan, task: T1, open});
				const first = stuckId(plan, T1, 1);
				yield* shows(folder, view, () => [first]);
				expect(yield* pageOf(folder, view, first, plan)).toContain("4 → 3 → 3 → 3");

				// The wrong kind of answer is refused by the core, and the desk says why on the same comment.
				h.reply(first, "/approve");
				yield* until(
					"the refusal on the comment",
					Effect.map(pageOf(folder, view, first, plan), (body) => body.includes("was not taken")),
				);

				h.reply(first, "/keep-going 3");
				yield* shows(folder, view, () => []);
				yield* until(
					"keep going kept",
					Effect.sync(() => answeredCount(disk) === 7),
				);
				for (const open of [3, 3]) h.core.tell("reviewed", {plan, task: T1, open});
				yield* until(
					"two rounds kept",
					Effect.sync(() => disk.read().length === 6 + 6 + 4 + 1 + 2),
				);
				expect(yield* inboxIds(folder, view)).toEqual([]);
				h.core.tell("reviewed", {plan, task: T1, open: 3});
				const again = stuckId(plan, T1, 2);
				yield* shows(folder, view, () => [again]);
				expect(yield* pageOf(folder, view, again, plan)).toContain("the rounds you gave are spent");

				h.reply(again, "/reword c3 When the suite runs twice, both runs pass");
				yield* shows(folder, view, () => []);
				yield* stopAll(h);
			}),
		);
	});

	const branches: readonly {readonly text: string; readonly answer: AnswerBody}[] = [
		{
			text: "/rule lasting build (b): reject when no Subs are active.",
			answer: {
				kind: "rule",
				rule: "lasting",
				build: true,
				answer: "(b): reject when no Subs are active.",
			},
		},
		{
			text: "/rule lasting (b): reject when no Subs are active.",
			answer: {
				kind: "rule",
				rule: "lasting",
				build: false,
				answer: "(b): reject when no Subs are active.",
			},
		},
		{
			text: "/rule one-off build (b): reject when no Subs are active.",
			answer: {
				kind: "rule",
				rule: "one_off",
				build: true,
				answer: "(b): reject when no Subs are active.",
			},
		},
		{
			text: "/rule one-off (b): reject when no Subs are active.",
			answer: {
				kind: "rule",
				rule: "one_off",
				build: false,
				answer: "(b): reject when no Subs are active.",
			},
		},
	];

	for (const branch of branches)
		it(`demlik #68 ruled through the desk: ${branch.text.slice(6, 23).trim()}`, async () => {
			await run((disk) =>
				Effect.gen(function* () {
					const folder = yield* project;
					const h = yield* host(folder, tomlOf(folder, [DESK_PACK]), memoryStorage());
					const sixtyEight = RULINGS.find((r) => r.ruling.ticket.endsWith("#68"));
					if (sixtyEight === undefined) return yield* Effect.die(new Error("no #68"));
					h.core.tell("ruling", sixtyEight.ruling);
					const id = rulingId(sixtyEight.ruling.ticket);
					yield* shows(folder, "markdown", () => [id]);
					expect(yield* pageOf(folder, "markdown", id, sixtyEight.ruling.ticket)).toContain(
						"(b) reject when no Subs are active",
					);
					h.reply(id, branch.text);
					yield* shows(folder, "markdown", () => []);
					expect(disk.read().at(-1)?.fact).toEqual({type: "answered", id, answer: branch.answer});
					yield* stopAll(h);
				}),
			);
		});
});

describe("the core without the desk", SLOW, () => {
	it("with the desk off the core runs; its asks wait in the ledger, and the desk shows them all when it is turned on", async () => {
		await run((disk) =>
			Effect.gen(function* () {
				const folder = yield* project;
				const storage = memoryStorage();
				const off = yield* host(folder, tomlOf(folder, []), storage);
				expect(off.wired.packs).toEqual([]);
				for (const p of plans86b()) off.core.tell("planned", p);
				for (const {ruling} of RULINGS) off.core.tell("ruling", ruling);
				yield* until(
					"ten asks kept",
					Effect.sync(() => openIds(disk).length === 10),
				);
				yield* stopAll(off);
				const fs = yield* FileSystem.FileSystem;
				expect(yield* fs.exists(`${folder}/desk`)).toBe(false);

				const on = yield* host(folder, tomlOf(folder, [DESK_PACK]), storage);
				yield* shows(folder, "markdown", () => openIds(disk));
				expect(yield* inboxIds(folder, "markdown")).toHaveLength(10);
				yield* stopAll(on);
			}),
		);
	});

	it("a plan written again before it is answered: the desk shows the new version only", async () => {
		await run((disk) =>
			Effect.gen(function* () {
				const folder = yield* project;
				const h = yield* host(folder, tomlOf(folder, [DESK_PACK]), memoryStorage());
				const plans = plans86b();
				for (const p of plans) h.core.tell("planned", p);
				yield* shows(folder, "markdown", () => plans.map((p) => planId(p.ticket, 1)));
				const p393 = plans.find((p) => numberOf(p.ticket) === "393");
				if (p393 === undefined) return yield* Effect.die(new Error("no 393"));
				h.core.tell("planned", p393);
				yield* until(
					"v2 kept",
					Effect.sync(() => openIds(disk).includes(planId(p393.ticket, 2))),
				);
				yield* shows(folder, "markdown", () => openIds(disk));
				yield* pageSays(
					folder,
					"markdown",
					planId(p393.ticket, 1),
					nameOf(p393.ticket),
					"no longer waiting",
				);
				yield* stopAll(h);
			}),
		);
	});

	it("an ask answered while the desk was off is gone from the desk when it is turned on again", async () => {
		await run((disk) =>
			Effect.gen(function* () {
				const folder = yield* project;
				const storage = memoryStorage();
				const plans = plans86b();
				const first = yield* host(folder, tomlOf(folder, [DESK_PACK]), storage);
				for (const p of plans) first.core.tell("planned", p);
				yield* shows(folder, "markdown", () => plans.map((p) => planId(p.ticket, 1)));
				yield* stopAll(first);

				// The owner answers from somewhere else (a command line) while the desk is off.
				const off = yield* host(folder, tomlOf(folder, []), storage);
				const id = planId(urlOf("367"), 1);
				off.core.tell("answer", {id, answer: {kind: "approve"}});
				yield* until(
					"the answer kept",
					Effect.sync(() => answeredCount(disk) === 1),
				);
				yield* stopAll(off);

				const on = yield* host(folder, tomlOf(folder, [DESK_PACK]), storage);
				yield* shows(folder, "markdown", () => openIds(disk));
				expect(yield* inboxIds(folder, "markdown")).not.toContain(id);
				yield* pageSays(folder, "markdown", id, nameOf(urlOf("367")), "no longer waiting");
				yield* stopAll(on);
			}),
		);
	});
});

describe("what the host refuses before anything starts", SLOW, () => {
	const refusal = (toml: (folder: string) => string) =>
		run(() =>
			Effect.gen(function* () {
				const folder = yield* project;
				return yield* host(folder, toml(folder), memoryStorage()).pipe(Effect.flip);
			}),
		);

	it("a pack that is not installed where the config is", async () => {
		expect(await refusal(() => 'packs = ["@acme/not-here"]\n')).toMatchObject({
			_tag: "pack_refused",
			name: "@acme/not-here",
			why: "no package @acme/not-here is installed where the config is",
		});
	});

	it("a pack whose own settings do not fit, named by the pack", async () => {
		const why = await refusal(
			() => `packs = ["${DESK_PACK}"]\n\n[pack."${DESK_PACK}"]\nview = "slack"\n`,
		);
		expect(why).toMatchObject({_tag: "pack_refused", name: DESK_PACK});
		expect(String((why as {why: string}).why)).toContain("its settings");
	});

	it("a package that is not a pack", async () => {
		expect(await refusal(() => 'packs = ["effect"]\n')).toMatchObject({
			_tag: "pack_refused",
			name: "effect",
		});
	});
});

describe(
	"two packs through the core alone: ui-verification raises a check, the desk shows it",
	SLOW,
	() => {
		type Shipped = {readonly task: string; readonly build: number};
		const shippedOf = (disk: ReturnType<typeof memoryLedger>): readonly Shipped[] =>
			disk
				.read()
				.flatMap((e) =>
					e.fact.type === "shipped" ? [{task: e.fact.task, build: e.fact.build}] : [],
				);

		/** Plan 367, approved through the desk, with the desk and the ui pack on. */
		const approved367 = () =>
			Effect.gen(function* () {
				const folder = yield* project;
				const h = yield* host(folder, tomlOf(folder, [DESK_PACK, UI_PACK]), memoryStorage());
				const url = urlOf("367");
				const plan = nameOf(url);
				const p367 = plans86b().find((p) => p.ticket === url);
				if (p367 === undefined) return yield* Effect.die(new Error("no 367"));
				h.core.tell("planned", p367);
				yield* shows(folder, "markdown", () => [planId(url, 1)]);
				h.reply(planId(url, 1), "/approve");
				yield* shows(folder, "markdown", () => []);
				return {folder, h, plan};
			});

		const checkOf = (plan: PlanId, build: number) => checkId(plan, T1, build, "ui-verification");

		/** Wait until the ui pack's check of `build` is in the ledger; nothing may ship before it. */
		const raised = (disk: ReturnType<typeof memoryLedger>, build: number) =>
			Effect.gen(function* () {
				yield* until(
					`the check of build ${build}`,
					Effect.sync(() =>
						disk.read().some((e) => e.fact.type === "check_raised" && e.fact.build === build),
					),
				);
				expect(shippedOf(disk).filter((s) => s.build === build)).toEqual([]);
			});

		it("nothing a user sees changed: no ask, it ships as usual", async () => {
			await run((disk) =>
				Effect.gen(function* () {
					const {folder, h, plan} = yield* approved367();
					h.core.tell("build", {
						plan,
						task: T1,
						changes: ["packages/tea/src/fold.ts", "docs/fold.md"],
					});
					yield* until(
						"the build shipped",
						Effect.sync(() => shippedOf(disk).length === 1),
					);
					expect(shippedOf(disk)).toEqual([{task: T1, build: 1}]);
					expect(yield* inboxIds(folder, "markdown")).toEqual([]);
					expect(openIds(disk)).toEqual([]);
					yield* stopAll(h);
				}),
			);
		});

		it("something a user sees changed: the desk shows the check with its pictures; yes ships it", async () => {
			await run((disk) =>
				Effect.gen(function* () {
					const {folder, h, plan} = yield* approved367();
					h.core.tell("build", {plan, task: T1, changes: ["src/ui/inbox.tsx"]});
					yield* raised(disk, 1);
					const id = checkOf(plan, 1);
					yield* shows(folder, "markdown", () => [id]);
					const page = yield* pageOf(folder, "markdown", id, plan);
					expect(page).toContain("[before](");
					expect(page).toContain("[after](");
					expect(page).toContain("src/ui/inbox.tsx");
					// Held while the owner looks.
					expect(shippedOf(disk)).toEqual([]);
					h.reply(id, "/yes");
					yield* until(
						"the build shipped",
						Effect.sync(() => shippedOf(disk).length === 1),
					);
					expect(shippedOf(disk)).toEqual([{task: T1, build: 1}]);
					yield* stopAll(h);
				}),
			);
		});

		it("no, with a note: the note is a new criterion, the task is built again, and that build is checked", async () => {
			await run((disk) =>
				Effect.gen(function* () {
					const {folder, h, plan} = yield* approved367();
					h.core.tell("build", {plan, task: T1, changes: ["src/ui/inbox.tsx"]});
					yield* raised(disk, 1);
					const first = checkOf(plan, 1);
					yield* shows(folder, "markdown", () => [first]);
					const note = "When the inbox is empty, it says Nothing waits, not a blank page";
					h.reply(first, `/no ${note}`);
					yield* shows(folder, "markdown", () => []);
					yield* pageSays(folder, "markdown", first, plan, `no: ${note}`);
					const criteria = criteriaOf(foldLedger(disk.read()), plan, T1);
					// The note gets the next id the plan's book gives, after task 1's four.
					expect(criteria.at(-1)).toEqual({id: "c5", version: 1, text: note, task: T1});
					expect(shippedOf(disk)).toEqual([]);

					h.core.tell("build", {plan, task: T1, changes: ["src/ui/inbox.tsx", "src/ui/empty.css"]});
					yield* raised(disk, 2);
					const second = checkOf(plan, 2);
					yield* shows(folder, "markdown", () => [second]);
					h.reply(second, "/yes");
					yield* until(
						"build 2 shipped",
						Effect.sync(() => shippedOf(disk).length === 1),
					);
					expect(shippedOf(disk)).toEqual([{task: T1, build: 2}]);
					yield* stopAll(h);
				}),
			);
		});
	},
);
