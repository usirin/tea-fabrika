// Way (c)'s cells in the box: ask the person's app for a pass, open what it sends, drop it at the
// end. The box's key pair is made once per box (./seal.ts); its private key cannot be exported.
import {Context, Effect, Redacted} from "effect";
import {Box, readInbox, tellPerson} from "./cells.ts";
import type {ask, drop, LentMsg, open} from "./lent.ts";
import type {InboxSub} from "./machine.ts";
import type {makeKeys} from "./seal.ts";
import {Vault} from "./vault.ts";
import type {ToBox} from "./wire.ts";

export class Keys extends Context.Service<Keys, Awaited<ReturnType<typeof makeKeys>>>()(
	"exp154/Keys",
) {}

/** What the sealed pass is about: one box, one turn. A pass for another opens for none. */
export const aboutOf = (box: string, turn: number) => `${box}/${turn}`;

const unreachable = (why: string) => ({_tag: "unreachable" as const, why});

export const askCell = (cmd: ReturnType<typeof ask>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const keys = yield* Keys;
		yield* tellPerson(
			{kind: "pass_wanted", box: s.box, turn: cmd.turn, key: keys.publicKey},
			`${s.box}/pass_wanted/${cmd.turn}`,
		);
		s.say({ev: "pass_wanted", turn: cmd.turn});
		return {waitMs: s.waitMs};
	}).pipe(Effect.mapError((e) => unreachable(String(e))));

export const openCell = (cmd: ReturnType<typeof open>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const keys = yield* Keys;
		const vault = yield* Vault;
		const access = yield* Effect.tryPromise({
			try: () => keys.open(cmd.sealed, aboutOf(s.box, cmd.turn)),
			catch: () => ({_tag: "unsealed" as const, why: "the pass did not open"}),
		});
		const ok = yield* vault.put({
			access: Redacted.make(access),
			refresh: null,
			client: "",
			expiresAt: Date.now() + cmd.expires_in * 1000,
		});
		if (!ok) return yield* Effect.fail({_tag: "closed" as const, why: "the vault is closed"});
		s.say({ev: "lent", turn: cmd.turn, length: access.length, expires_in: cmd.expires_in});
		const life = cmd.expires_in * 1000;
		return {renewInMs: Math.max(0, life - Math.min(s.marginMs, life / 2))};
	});

export const dropCell = (cmd: ReturnType<typeof drop>) =>
	Effect.gen(function* () {
		const s = yield* Box;
		const vault = yield* Vault;
		const h = yield* vault.close;
		s.say({ev: "forgotten", why: cmd.why, revoked: false, held: h !== null});
		yield* tellPerson(
			{kind: "sign_in_ended", box: s.box, why: cmd.why, revoked: false},
			`${s.box}/ended`,
		).pipe(Effect.ignore);
		return null;
	});

const lentMsgOf = (m: ToBox): LentMsg | null => {
	switch (m.kind) {
		case "pass":
			return {
				type: "pass",
				turn: m.turn,
				sealed: m.sealed,
				expires_in: m.expires_in,
				scopes: m.scopes,
			};
		case "no_pass":
			return {type: "no_pass", turn: m.turn, why: m.why};
		case "end":
			return {type: "end"};
		default:
			return null;
	}
};

export const lentInboxRunner = (_: InboxSub) => readInbox(lentMsgOf);
