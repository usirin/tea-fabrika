// P23, next/. scenario: these laws need real Electron, Chromium and P12's local stage.
// This box cannot start those processes or sockets. Missing exports are red; EPERM/EMFILE are neither.
import {describe, expect, it} from "@effect/vitest";
import {grantText, MemberFact, revokeText} from "@kampus/libfabrika/coordination";
import {type Entry, valueFor} from "@kampus/libfabrika/data";
import {checkSshsig} from "@kampus/libfabrika/transport";
import {Effect, Schema} from "effect";
import {
	click,
	count,
	freshHome,
	launchdState,
	launchP23,
	linkTab,
	outside,
	ownedProcessIds,
	press,
	processesAbsent,
	startDemo,
	visible,
} from "./p23.test-support.ts";

const facts = (entries: ReadonlyArray<Entry>) =>
	entries
		.filter((entry) => entry.stream === "door/members")
		.map((entry) => Schema.decodeUnknownSync(MemberFact)(valueFor(entry)));
const acceptedPresses = (entries: ReadonlyArray<Entry>) =>
	entries.filter(
		(entry) =>
			entry.stream.startsWith("counter:") &&
			entry.stream.endsWith("/inbox") &&
			entry._tag === "send" &&
			Schema.is(Schema.Struct({m: Schema.Struct({type: Schema.Literal("inc")})}))(entry.body),
	);
const found = (demo: import("./p23.test-support.ts").Demo) =>
	Effect.gen(function* () {
		yield* outside("browser", () => demo.window.getByRole("textbox", {name: /name/i}).fill("Demo"));
		yield* click(demo.window, "Start");
		yield* visible(demo.window, "Online");
		yield* demo.menuReady;
	});
describe("P23 real app demo", () => {
	// Plan reason: real built Electron and Chromium clients exchange accepted presses through P12's stage.
	it.live(
		"scenario: p31 founding and a linked tab press both ways through accepted publications",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* found(demo);
				expect(facts(yield* demo.entries).filter((fact) => fact._tag === "founded")).toHaveLength(
					1,
				);
				const tab = yield* linkTab(demo);
				yield* visible(tab.page, "Online");
				expect(new URL(tab.page.url()).hash).toBe("");
				yield* press(demo.window);
				yield* visible(tab.page, "1");
				yield* press(tab.page);
				yield* visible(demo.window, "2");
				expect(yield* count(demo.window)).toEqual(yield* count(tab.page));
				const all = yield* demo.entries;
				const grants = facts(all).filter((fact) => fact._tag === "granted");
				expect(grants).toHaveLength(1);
				for (const fact of grants) {
					expect(fact.grant.saw).toMatchObject({how: "link", check: "none"});
					expect(fact.signed.text).toBe(grantText(fact.grant));
					expect(
						yield* checkSshsig({
							text: grantText(fact.grant),
							armored: fact.signed.armored,
							space: "fabrika-client",
							signers: [fact.signed.signer],
						}),
					).toMatchObject({signer: fact.signed.signer});
				}
				expect(acceptedPresses(all)).toHaveLength(2);
				// Plant: a local count without the second publication fails this same assertion.
				expect(() => expect(acceptedPresses(all).slice(0, 1)).toHaveLength(2)).toThrow();
			}),
	);
	// Plan reason: actual app shutdown and reopening must reuse the persisted key.
	it.live("scenario: p31 Quit and reopen retain the key and require no second grant", () =>
		Effect.gen(function* () {
			const demo = yield* startDemo();
			yield* found(demo);
			const tab = yield* linkTab(demo);
			yield* visible(tab.page, "Online");
			const before = facts(yield* demo.entries);
			yield* demo.quit;
			yield* demo.reopen;
			yield* visible(demo.window, "Online");
			expect(facts(yield* demo.entries)).toEqual(before);
			yield* press(demo.window);
			yield* visible(tab.page, "1");
		}),
	);
	// Plan reason: killing the real stage with a queued press combines process loss, reconnect and durable retry.
	it.live("scenario: p31 brain loss recovers both clients and a queued press lands once", () =>
		Effect.gen(function* () {
			const demo = yield* startDemo();
			yield* found(demo);
			const tab = yield* linkTab(demo);
			yield* visible(tab.page, "Online");
			yield* demo.killBrain;
			yield* visible(demo.window, "Disconnected");
			yield* visible(tab.page, "Disconnected");
			yield* press(tab.page);
			yield* visible(tab.page, /queued/i);
			yield* visible(demo.window, "Online");
			yield* visible(tab.page, "Online");
			yield* visible(demo.window, "1");
			const accepted = acceptedPresses(yield* demo.entries);
			expect(accepted).toHaveLength(1);
			expect(new Set(accepted.map((entry) => entry.id)).size).toBe(1);
			expect(yield* count(tab.page)).toEqual(yield* count(demo.window));
		}),
	);
	// Plan reason: real renderer contexts, navigation and sealed storage need a running Electron build.
	it.live("scenario: p31 renderer isolation, navigation and arbitrary signing remain refused", () =>
		Effect.gen(function* () {
			const demo = yield* startDemo();
			yield* found(demo);
			const isolation = yield* outside("browser", () =>
				demo.window.evaluate(() => ({
					process: typeof globalThis.process,
					require: typeof globalThis.require,
					keys: Object.keys(globalThis).filter((key) =>
						/private|personKey|launchctl|ipcRenderer/.test(key),
					),
					bridge: Object.keys(globalThis.fabrika ?? {}).filter((key) =>
						/^(sign|grant|revoke|openExternal|readFile)$/.test(key),
					),
				})),
			);
			expect(isolation).toEqual({process: "undefined", require: "undefined", keys: [], bridge: []});
			expect(yield* demo.privateFilesAreSealed).toBe(true);
			const prefs = yield* outside("launch", () =>
				demo.app.evaluate(({BrowserWindow}) =>
					BrowserWindow.getAllWindows().map((window) => window.webContents.getLastWebPreferences()),
				),
			);
			for (const pref of prefs)
				expect(pref).toMatchObject({sandbox: true, contextIsolation: true, nodeIntegration: false});
			const url = demo.window.url();
			yield* outside("browser", () =>
				demo.window.evaluate(() => {
					location.href = "https://outside.example/";
				}),
			);
			expect(demo.window.url()).toBe(url);
			const tab = yield* linkTab(demo);
			yield* outside("browser", () => tab.page.goto(`${demo.url}/electron`));
			expect(
				yield* outside("browser", () =>
					tab.page.evaluate(() => ({
						process: typeof globalThis.process,
						require: typeof globalThis.require,
						bridge: typeof globalThis.fabrika,
					})),
				),
			).toEqual({process: "undefined", require: "undefined", bridge: "undefined"});
		}),
	);
	// Plan reason: focus, Enter, canceled checks, Deny and Ask again must work across both real windows.
	it.live(
		"scenario: p47 Enter, canceled approval, denial and Ask again preserve the compared row",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* found(demo);
				const context = yield* outside("browser", () => demo.browser.newContext());
				const tab = yield* outside("browser", () => context.newPage());
				yield* outside("browser", () => tab.goto(demo.url));
				yield* visible(tab, /waiting/i);
				const code = yield* outside("browser", () =>
					tab.getByRole("status", {name: /code/i}).innerText(),
				);
				yield* visible(demo.popover, code);
				const approve = demo.popover.getByRole("button", {name: "Approve", exact: true});
				expect(
					yield* outside("browser", () =>
						approve.evaluate((button) => button === document.activeElement),
					),
				).toBe(false);
				yield* outside("browser", () => approve.focus());
				yield* outside("browser", () => approve.press("Enter"));
				expect(facts(yield* demo.entries).filter((fact) => fact._tag === "granted")).toHaveLength(
					0,
				);
				yield* demo.answerCheck("no");
				yield* outside("browser", () => approve.press("Space"));
				expect(facts(yield* demo.entries).filter((fact) => fact._tag === "granted")).toHaveLength(
					0,
				);
				yield* click(demo.popover, "Deny");
				yield* visible(tab, /denied/i);
				expect(facts(yield* demo.entries).filter((fact) => fact._tag === "denied")).toHaveLength(1);
				yield* click(tab, "Ask again");
				yield* visible(tab, /waiting/i);
				yield* demo.answerCheck("click");
				yield* click(demo.popover, "Approve");
				yield* visible(tab, "Online");
				const grants = facts(yield* demo.entries).filter((fact) => fact._tag === "granted");
				expect(grants).toHaveLength(1);
				expect(grants[0].grant.saw).toMatchObject({how: "compare", check: "click"});
			}),
	);
	// Plan reason: tab closure, removed words and two checked keys in flight need the complete running app.
	it.live(
		"scenario: p51 two removals in flight retain each checked key, signed fact and close 4003",
		() =>
			Effect.gen(function* () {
				const demo = yield* startDemo();
				yield* found(demo);
				const a = yield* linkTab(demo),
					b = yield* linkTab(demo);
				yield* visible(a.page, "Online");
				yield* visible(b.page, "Online");
				const before = facts(yield* demo.entries);
				const remove = demo.popover.getByRole("button", {name: "Remove", exact: true}).first();
				yield* outside("browser", () => remove.focus());
				yield* outside("browser", () => remove.press("Enter"));
				expect(facts(yield* demo.entries)).toEqual(before);
				yield* demo.answerCheck("no");
				yield* outside("browser", () =>
					demo.popover.getByRole("button", {name: "Remove", exact: true}).first().click(),
				);
				expect(facts(yield* demo.entries)).toEqual(before);
				yield* demo.answerCheck("click");
				yield* outside("browser", () =>
					demo.popover.getByRole("button", {name: "Remove", exact: true}).first().click(),
				);
				yield* demo.answerCheck("touch");
				yield* outside("browser", () =>
					demo.popover.getByRole("button", {name: "Remove", exact: true}).last().click(),
				);
				yield* visible(a.page, /removed/i);
				yield* visible(b.page, /removed/i);
				const revoked = facts(yield* demo.entries).filter((fact) => fact._tag === "revoked");
				expect(revoked).toHaveLength(2);
				expect(new Set(revoked.map((fact) => fact.revoke.key))).toEqual(
					new Set(before.filter((fact) => fact._tag === "granted").map((fact) => fact.grant.key)),
				);
				const founder = before.find((fact) => fact._tag === "founded");
				if (!founder) return yield* Effect.die("founding fact missing");
				for (const fact of revoked) {
					expect(founder.keys).toContain(fact.signed.signer);
					expect(fact.signed.signer).not.toBe(founder.window);
					expect(fact.revoke.saw.how).toBe("panel");
					expect(fact.signed.text).toBe(revokeText(fact.revoke));
					expect(
						yield* checkSshsig({
							text: revokeText(fact.revoke),
							armored: fact.signed.armored,
							space: "fabrika-client",
							signers: founder.keys,
						}),
					).toMatchObject({signer: fact.signed.signer});
				}
				for (const page of [a.page, b.page])
					expect(
						yield* outside("browser", () => page.evaluate(() => globalThis.p23Closes)),
					).toContain(4003);
			}),
	);
	// Plan reason: only the owner opening the actual build twice can say whether an OS prompt appeared.
	it.live(
		"scenario: c13 owner reports two real opens, a finger check and the default-browser handoff",
		() =>
			Effect.gen(function* () {
				// Only the owner supplies this observation. An automated capability probe is not an answer.
				const OwnerResult = Schema.Struct({
					opens: Schema.Tuple([Schema.Boolean, Schema.Boolean]),
					finger: Schema.Boolean,
					browser: Schema.Boolean,
				});
				expect(
					process.env.P23_OWNER_RESULT,
					"missing owner observation fixture P23_OWNER_RESULT",
				).toBeDefined();
				const observation = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OwnerResult))(
					process.env.P23_OWNER_RESULT,
				);
				// The owner runs those steps on the real app. Automation must not claim to observe the OS prompt.
				expect(observation.opens).toEqual([false, false]);
				expect(observation.finger).toBe(true);
				expect(observation.browser).toBe(true);
			}),
	);
	for (const brain of ["stand-in", "launchd"] as const) {
		// Plan reason: launchd ownership after a real app kill needs a laptop; CI proves the stand-in contract.
		it.live(`scenario: p48 ${brain} app crash leaves the brain and admitted tab working`, () =>
			Effect.gen(function* () {
				const demo = yield* startDemo({brain});
				yield* found(demo);
				const tab = yield* linkTab(demo);
				yield* visible(tab.page, "Online");
				yield* demo.killApp;
				yield* press(tab.page);
				yield* visible(tab.page, "1");
				const stranger = yield* outside("browser", () => demo.browser.newPage());
				yield* outside("browser", () => stranger.goto(demo.url));
				yield* visible(stranger, /waiting/i);
				yield* demo.reopen;
				yield* visible(demo.window, "Online");
				yield* demo.answerCheck("click");
				yield* click(demo.popover, "Approve");
				yield* visible(stranger, "Online");
			}),
		);
		// Plan reason: launchd label, process and listener absence need a real reopen and Quit.
		it.live(
			`scenario: p48 ${brain} reopen reuses one brain and Quit removes service, workerd and listener`,
			() =>
				Effect.gen(function* () {
					const home = yield* freshHome(),
						label = `test.p23.${home.split("/").at(-1)}`;
					const demo = yield* launchP23({
						home,
						label,
						layout: "one",
						look: "dark",
						brain,
						seal: "stand-in",
					});
					yield* found(demo);
					const url = demo.url;
					const before = brain === "launchd" ? yield* launchdState(label) : "stand-in";
					const children = yield* ownedProcessIds(home, label, brain);
					expect(children.length).toBeGreaterThan(1);
					yield* demo.killApp;
					yield* demo.reopen;
					yield* visible(demo.window, "Online");
					expect(demo.url).toBe(url);
					if (brain === "launchd") expect(yield* launchdState(label)).toBe(before);
					yield* demo.quit;
					if (brain === "launchd") expect(yield* launchdState(label)).toBe("absent");
					const response = yield* Effect.result(outside("stage", () => fetch(url)));
					expect(response._tag).toBe("Failure");
					expect(yield* processesAbsent(children)).toBe(true);
				}),
		);
	}
});
