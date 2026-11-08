import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import {join} from "node:path";
import {Effect, Schema, Semaphore} from "effect";

const Life = {
	id: Schema.NonEmptyString,
	start: Schema.NonEmptyString,
	at: Schema.Number,
};
const Reason = Schema.Literals(["open", "crash", "memory", "core"]);
const Exit = {
	exitCode: Schema.optionalKey(Schema.NullOr(Schema.Int)),
	signal: Schema.optionalKey(Schema.NullOr(Schema.String)),
	bytes: Schema.optionalKey(Schema.Int),
	backoff: Schema.optionalKey(Schema.Number),
};
export const BrainFact = Schema.TaggedUnion({
	started: {
		...Life,
		after: Schema.NullOr(Schema.String),
		build: Schema.String,
		why: Reason,
		pid: Schema.Int,
		...Exit,
	},
	exited: {...Life, why: Reason, ...Exit},
	braked: {...Life, why: Schema.Literals(["intensity", "restart_failed"]), ...Exit},
	stopped: {...Life, why: Schema.Literal("stop"), ...Exit},
});
class BrainError extends Schema.TaggedError<BrainError>()("BrainError", {
	why: Schema.Literals(["storage", "bad_row", "id_reused"]),
}) {}

export const checkMemory = Effect.fn("brain.checkMemory")(function* <E, R>(options: {
	readonly pid: number;
	readonly sample: (pid: number) => Effect.Effect<number, E, R>;
	readonly replace: (reason: {
		why: "memory";
		pid: number;
		bytes: number;
	}) => Effect.Effect<void, E, R>;
}) {
	const bytes = yield* options.sample(options.pid);
	if (bytes >= 500_000_000) yield* options.replace({why: "memory", pid: options.pid, bytes});
});

export const brainOutbox = Effect.fn("brain.outbox")(function* (home: string) {
	const file = join(home, "brain.pending.jsonl");
	const lastFile = join(home, "brain.last.json");
	const turn = yield* Semaphore.make(1);
	const read = Effect.try({
		try: () => {
			if (!existsSync(file)) return [];
			return readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((row) => Schema.decodeUnknownSync(BrainFact)(JSON.parse(row)));
		},
		catch: () => new BrainError({why: "bad_row"}),
	});
	const write = (rows: ReadonlyArray<typeof BrainFact.Type>) =>
		Effect.try({
			try: () => {
				mkdirSync(home, {recursive: true});
				const pending = `${file}.tmp`;
				const fd = openSync(pending, "w", 0o600);
				try {
					writeFileSync(
						fd,
						rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
					);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				renameSync(pending, file);
				const dir = openSync(home, "r");
				try {
					fsyncSync(dir);
				} finally {
					closeSync(dir);
				}
			},
			catch: () => new BrainError({why: "storage"}),
		});
	const last = Effect.fnUntraced(function* () {
		const pending = (yield* read).filter((fact) => fact._tag === "started").at(-1);
		if (pending !== undefined) return pending.start;
		return yield* Effect.try({
			try: () =>
				existsSync(lastFile)
					? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.NonEmptyString))(
							readFileSync(lastFile, "utf8"),
						)
					: null,
			catch: () => new BrainError({why: "bad_row"}),
		});
	});
	const saveLast = Effect.fnUntraced(function* () {
		const start = yield* last();
		if (start === null) return;
		yield* Effect.try({
			try: () => {
				const pending = `${lastFile}.tmp`;
				const fd = openSync(pending, "w", 0o600);
				try {
					writeFileSync(fd, JSON.stringify(start));
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				renameSync(pending, lastFile);
				const dir = openSync(home, "r");
				try {
					fsyncSync(dir);
				} finally {
					closeSync(dir);
				}
			},
			catch: () => new BrainError({why: "storage"}),
		});
	});
	return {
		last: last().pipe(turn.withPermit),
		pending: read.pipe(turn.withPermit),
		add: Effect.fn("brain.pending")(function* (raw: unknown) {
			yield* Effect.gen(function* () {
				const fact = yield* Schema.decodeUnknownEffect(BrainFact)(raw).pipe(
					Effect.mapError(() => new BrainError({why: "bad_row"})),
				);
				const rows = yield* read;
				const old = rows.find((row) => row.id === fact.id);
				if (old !== undefined) {
					if (JSON.stringify(old) !== JSON.stringify(fact))
						return yield* new BrainError({why: "id_reused"});
					return;
				}
				yield* write([...rows, fact]);
				if (fact._tag === "started") yield* saveLast();
			}).pipe(turn.withPermit);
		}),
		flush: Effect.fn("brain.flush")(function* <E, R>(
			send: (fact: typeof BrainFact.Type) => Effect.Effect<unknown, E, R>,
		) {
			yield* Effect.gen(function* () {
				const rows = [...(yield* read)];
				yield* saveLast();
				for (const row of [...rows]) {
					yield* send(row);
					rows.shift();
					yield* write(rows);
				}
			}).pipe(turn.withPermit);
		}),
	};
});

export const localStage = Effect.fn("brain.localStage")(function* (
	built: import("./build.ts").Built,
	options: Omit<import("./settings.ts").Settings, "build"> & {readonly home: string},
) {
	process.env.DO_NOT_TRACK = "1";
	process.env.ALCHEMY_HOME = join(options.home, "alchemy-home");
	// oxlint-disable-next-line fabrika/no-promises -- edge: load Alchemy only after disabling its telemetry
	const {startStage} = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: defer Alchemy loading until telemetry is disabled
		try: () => import("./stage.ts"),
		catch: () => new BrainError({why: "storage"}),
	});
	// oxlint-disable-next-line fabrika/no-promises -- edge: the platform module is loaded at the local command boundary
	const {ProcessIdGenerator} = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: load the platform dependency at the command boundary
		try: () => import("@kampus/libfabrika/coordination"),
		catch: () => new BrainError({why: "storage"}),
	});
	return yield* startStage(built, options).pipe(Effect.provide(ProcessIdGenerator.layer));
});
