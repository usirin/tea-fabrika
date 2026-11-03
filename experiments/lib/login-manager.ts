// One login manager per person: it holds the person's refresh token, spends it one refresh at a
// time, and hands jobs only short-lived access tokens. Built for experiment 160.
//
// The rule it follows is OpenAI's OAuth guidance: "serialize refreshes for the same session so two
// processes do not race a rotating token". A job that finds its access token dead asks `renew` with
// the token it holds. If someone already renewed past that token, the job gets the newer one and
// no refresh is spent. So four jobs that ask at once share one refresh.
//
// `serial: false` turns both guards off on purpose: every ask spends the refresh token the manager
// holds at that moment. It exists only to show what the guards prevent.
import {Clock, Effect, Redacted, Ref, Schema, Semaphore} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";

/** What a job gets. The shape of app-server's `account/chatgptAuthTokens/refresh` answer. */
export const Grant = Schema.Struct({
	accessToken: Schema.String,
	chatgptAccountId: Schema.String,
	chatgptPlanType: Schema.NullOr(Schema.String),
});
export type Grant = typeof Grant.Type;

/** The token endpoint's answer to a refresh (RFC 6749 section 5.1), the parts we keep. */
const Answer = Schema.Struct({
	access_token: Schema.String,
	refresh_token: Schema.String,
	expires_in: Schema.Number,
});

/** The provider refused the refresh: the person must sign in again. */
export class LoginDead extends Schema.TaggedError<LoginDead>()("LoginDead", {
	status: Schema.Number,
}) {}

/** A live login holds a refresh token; a dead one holds only why it died. */
type Login =
	| {readonly kind: "live"; readonly grant: Grant; readonly refresh: Redacted.Redacted<string>}
	| {readonly kind: "dead"; readonly status: number};

/** One refresh the manager sent, timed. */
export interface Spend {
	readonly ok: boolean;
	readonly from: number;
	readonly to: number;
}

export interface Counts {
	/** Every `renew` call. */
	readonly asks: number;
	/** Asks answered with a token someone else already renewed: no refresh spent. */
	readonly shared: number;
	readonly spends: readonly Spend[];
}

export interface LoginManager {
	/** The access token to start a job with. */
	readonly grant: Effect.Effect<Grant, LoginDead>;
	/** A job's token `stale` was refused. Answers a newer token, spending a refresh only if needed. */
	readonly renew: (stale: string) => Effect.Effect<Grant, LoginDead>;
	readonly counts: Effect.Effect<Counts>;
}

export interface SignIn {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly accountId: string;
	readonly planType: string | null;
}

export const makeLoginManager = (o: {
	readonly tokenUrl: string;
	readonly clientId: string;
	readonly signIn: SignIn;
	readonly serial: boolean;
	/** Wait this long before each refresh: a slow provider. */
	readonly delayMs?: number;
}) =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		const permit = yield* Semaphore.make(1);
		const login = yield* Ref.make<Login>({
			kind: "live",
			grant: {
				accessToken: o.signIn.accessToken,
				chatgptAccountId: o.signIn.accountId,
				chatgptPlanType: o.signIn.planType,
			},
			refresh: Redacted.make(o.signIn.refreshToken),
		});
		const counts = yield* Ref.make<Counts>({asks: 0, shared: 0, spends: []});

		const now = Clock.currentTimeMillis;

		const live = Effect.flatMap(Ref.get(login), (l) =>
			l.kind === "live" ? Effect.succeed(l) : Effect.fail(new LoginDead({status: l.status})),
		);

		/** Spend the refresh token once. On any refusal the login is dead and stays dead. */
		const spend = (held: Extract<Login, {kind: "live"}>) =>
			Effect.gen(function* () {
				if (o.delayMs !== undefined) yield* Effect.sleep(o.delayMs);
				const from = yield* now;
				const res = yield* http
					.execute(
						HttpClientRequest.post(o.tokenUrl).pipe(
							HttpClientRequest.bodyJsonUnsafe({
								grant_type: "refresh_token",
								refresh_token: Redacted.value(held.refresh),
								client_id: o.clientId,
							}),
						),
					)
					.pipe(Effect.orDie);
				const ok = res.status === 200;
				const to = yield* now;
				yield* Ref.update(counts, (c) => ({...c, spends: [...c.spends, {ok, from, to}]}));
				if (!ok) {
					yield* Ref.set(login, {kind: "dead", status: res.status});
					return yield* new LoginDead({status: res.status});
				}
				const a = yield* HttpClientResponse.schemaBodyJson(Answer)(res).pipe(Effect.orDie);
				const grant: Grant = {...held.grant, accessToken: a.access_token};
				yield* Ref.set(login, {kind: "live", grant, refresh: Redacted.make(a.refresh_token)});
				return grant;
			});

		const renewSerial = (stale: string) =>
			permit.withPermit(
				Effect.gen(function* () {
					const held = yield* live;
					if (held.grant.accessToken !== stale) {
						yield* Ref.update(counts, (c) => ({...c, shared: c.shared + 1}));
						return held.grant;
					}
					return yield* spend(held);
				}),
			);

		const renewLoose = (_stale: string) => Effect.flatMap(live, spend);

		const manager: LoginManager = {
			grant: Effect.map(live, (l) => l.grant),
			renew: (stale) =>
				Ref.update(counts, (c) => ({...c, asks: c.asks + 1})).pipe(
					Effect.andThen(o.serial ? renewSerial(stale) : renewLoose(stale)),
				),
			counts: Ref.get(counts),
		};
		return manager;
	});
