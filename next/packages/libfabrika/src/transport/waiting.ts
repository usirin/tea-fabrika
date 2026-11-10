import {Schema} from "effect";

export const Row = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	where: Schema.String,
	code: Schema.String,
	until: Schema.Number,
	tabs: Schema.Int,
	clients: Schema.Array(Schema.String),
	pass: Schema.NullOr(Schema.String),
	has: Schema.Array(Schema.String),
	as: Schema.Literals(["window", "agent"]),
});

export class Waiting extends Schema.Opaque<Waiting>()(
	Schema.Struct({
		rows: Schema.Array(Row),
		most: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
		ttl: Schema.Number,
	}),
) {
	static expire(state: Waiting, at: number): Waiting {
		return Waiting.make({...state, rows: state.rows.filter((r) => r.until > at)});
	}

	static knock(
		state: Waiting,
		a: Omit<typeof Row.Type, "until" | "tabs" | "clients"> & {
			readonly client: string;
			readonly at: number;
		},
	): Waiting {
		const live = Waiting.expire(state, a.at);
		const old = live.rows.find((r) => r.key === a.key);
		if (old !== undefined) {
			const clients = [...new Set([...old.clients, a.client])];
			return Waiting.make({
				...live,
				rows: live.rows.map((r) => (r === old ? {...old, clients, tabs: clients.length} : r)),
			});
		}
		const {client, at, ...row} = a;
		return Waiting.make({
			...live,
			rows: [
				...live.rows,
				Row.make({...row, clients: [client], tabs: 1, until: at + state.ttl}),
			].slice(-state.most),
		});
	}

	static leave(state: Waiting, a: {readonly key: string; readonly client: string}): Waiting {
		return Waiting.make({
			...state,
			rows: state.rows
				.map((r) => {
					if (r.key !== a.key) return r;
					const clients = r.clients.filter((c) => c !== a.client);
					return {...r, clients, tabs: clients.length};
				})
				.filter((r) => r.tabs > 0),
		});
	}
}
