import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runTraceId} from "@demlik/tea/otel";
import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import {
	ear,
	HostJobs,
	memoryStorage,
	openJobs,
	Shell,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika";
import {agentTrace} from "@kampus/fabrika/agents/trace";
import {endpointOf, memoryTracing} from "@kampus/fabrika/otel";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {SpanStatusCode} from "@opentelemetry/api";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Duration, Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../code-host-github.ts";
import {CodeHost} from "../services.ts";
import {changed, HEADS, RUBRICS, recorded, recordedGh} from "../stages/review/scripted.ts";
import type {PrFacts} from "../stages/ship/facts.ts";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {defaultConfig} from "./config.ts";
import {fabrikaEntries} from "./fabrika.ts";

// Tracing, as the owner uses it: one tsh line, one trace, read back as a
// tree. Spans are kept in memory here (`memoryTracing`), as a viewer is sent
// them; `TSH_TRACE` sends the same spans to Jaeger.

const {Programs, programList, Shorten, SMALL, tsh} = Shell;
type ProgramList = Shell.ProgramList;
type Printed = Shell.Printed;
type Ready = Shell.Ready;

let runs = 0;
/** One tsh on a storage; `line` tells it a line and waits for its `ready`. */
const session = (list: ProgramList, storage: Storage) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const jobs = yield* openJobs(storage);
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:trace-${runs}`, storage},
		).pipe(
			Effect.provideService(Programs, list),
			Effect.provideService(HostJobs, jobs),
			Effect.provideService(Shorten, refOf),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				const all = yield* ready.upTo(told);
				return {
					status: all[told - 1]?.status,
					said: printed.values.slice(from).map((p) => p.text),
				};
			});
		const heard = (text: string) =>
			Effect.gen(function* () {
				while (!printed.values.some((p) => p.text.includes(text)))
					yield* Effect.sleep(Duration.millis(5));
			});
		return {started, line, heard};
	});

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;
/** Clear once a review has kept its rows: each closes the ticket the recorded body names ("Fixes #625"). */
const clear: PrFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: {id: "example/repo#625", link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	main: {tested: "main0", tip: "main0"},
};
/** The recorded pull request, open at the head that merged; a draft when `draft`. */
const opened = (draft: boolean) =>
	changed(recorded("change-final.json"), (repo) => {
		repo.pullRequest.state = "OPEN";
		repo.pullRequest.isDraft = draft;
		repo.pullRequest.headRefOid = HEADS.final;
	});

/**
 * GitHub, read from recordings. Pull request 2 is a draft: review skips it,
 * and passes nothing on. Pull request 3's checks are stuck: ship stops there.
 */
const recordedGitHub = () => {
	const host = Layer.succeed(CodeHost, {
		pullRequests: () => Effect.succeed([]),
		prFacts: (pr: string) =>
			Effect.succeed(pr === url(3) ? {...clear, checks: "stuck" as const} : clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened(pr === url(2))});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.never,
	});
	return programList([...SMALL, ...fabrikaEntries(defaultConfig("/tsh"), () => host)]);
};

const idOf = (span: ReadableSpan) => span.spanContext().spanId;
const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;
const childrenOf = (spans: readonly ReadableSpan[], parent: ReadableSpan) =>
	spans.filter((s) => parentOf(s) === idOf(parent));
const prOf = (span: ReadableSpan) => span.attributes["vcs.change.id"];
const serviceOf = (span: ReadableSpan) => span.resource.attributes["service.name"];
const red = (span: ReadableSpan) => span.status.code === SpanStatusCode.ERROR;
/** The spans of one program's own run: tsh's, which is not a line's. */
const isTshRun = (span: ReadableSpan) => span.attributes["tea.program.name"] === "tsh";

/**
 * The spans as a viewer lists them: one line each, the service then the name,
 * children indented under their parent, `!` on a red one, events after `·`.
 */
const drawn = (spans: readonly ReadableSpan[]): string => {
	const ids = new Set(spans.map(idOf));
	const line = (span: ReadableSpan, depth: number): string[] => {
		const events =
			span.events.length === 0 ? "" : `  · ${span.events.map((e) => e.name).join(", ")}`;
		const links = span.links.length === 0 ? "" : `  ↔ ${span.links.length} link`;
		return [
			`${"  ".repeat(depth)}${String(serviceOf(span))}  ${span.name}${red(span) ? " !" : ""}${links}${events}`,
			...childrenOf(spans, span)
				.toSorted(
					(a, b) => a.startTime[1] - b.startTime[1] + (a.startTime[0] - b.startTime[0]) * 1e9,
				)
				.flatMap((c) => line(c, depth + 1)),
		];
	};
	return spans
		.filter((s) => !ids.has(parentOf(s) ?? ""))
		.flatMap((root) => line(root, 0))
		.join("\n");
};

describe("tracing: the user's job", () => {
	it("one review | ship line is one trace a person reads: named by what ran, a color per stage, red where it stopped", async () => {
		const {spans, layer} = memoryTracing({viewing: FABRIKA_VIEWING});
		const list = recordedGitHub();
		const prs = [1, 2, 3].map((n) => `pr=${url(n)}`).join(" ");
		const text = `review-scripted --rubrics ${RUBRICS} --model opus --effort medium --budget 1 ${prs} | ship --mode read`;
		const said = await Effect.runPromise(
			Effect.gen(function* () {
				const {line, started} = yield* session(list, memoryStorage());
				const done = yield* line(text);
				started.close("line");
				yield* started.run.ended;
				return done;
			}).pipe(Effect.scoped, Effect.provide(layer)),
		);
		expect(said.status).toBe(0);
		const line = drawn(spans.filter((s) => !isTshRun(s)));
		expect(line.split("\n").map((l) => l.replace(/ {2}[↔·].*$/, ""))).toEqual([
			"tsh  review-scripted pr #1 #2 #3 | ship",
			"  ship  run",
			"    ship  pr #1",
			"      ship  read pull request",
			"    ship  pr #3 !",
			"      ship  read pull request",
			"  review-scripted  run",
			// review works its pull requests off its kept queue (experiment 75b).
			"    review-scripted  queue",
			"    review  pr #1",
			"      review  read pull request",
			"      review  reviewer",
			"    review  pr #2",
			"      review  read pull request",
			"    review  pr #3",
			"      review  read pull request",
			"      review  reviewer",
		]);

		// The line is the root of its trace, with no parent a viewer would look for, and
		// everything under it is in that trace.
		const roots = spans.filter((s) => s.attributes["tsh.line"] !== undefined);
		expect(roots).toHaveLength(1);
		const [root] = roots;
		if (root === undefined) throw new Error("no line span");
		expect(root.attributes["tsh.line"]).toBe(text);
		expect(root.parentSpanContext).toBeUndefined();
		const trace = root.spanContext().traceId;
		const inLine = spans.filter((s) => s.spanContext().traceId === trace);
		expect(spans.filter((s) => !isTshRun(s) && s.spanContext().traceId !== trace)).toEqual([]);
		// No span says `service.name` itself: it moved to where a viewer reads it.
		expect(inLine.filter((s) => s.attributes["service.name"] !== undefined)).toEqual([]);

		// One run span per program, each a child of the line, linked to each other both ways.
		const runsUnder = childrenOf(inLine, root);
		expect(runsUnder.map((s) => s.attributes["tea.program.name"]).toSorted()).toEqual([
			"review-scripted",
			"ship",
		]);
		const review = runsUnder.find((s) => serviceOf(s) === "review-scripted");
		const ship = runsUnder.find((s) => serviceOf(s) === "ship");
		if (review === undefined || ship === undefined) throw new Error("no run spans");
		expect(review.attributes["tea.run.id"]).toMatch(/^review-scripted:/);
		expect(review.links.map((l) => [l.context.spanId, l.attributes?.["tea.pipe.output"]])).toEqual([
			[idOf(ship), "passed"],
		]);
		expect(ship.links.map((l) => [l.context.spanId, l.attributes?.["tea.pipe.input"]])).toEqual([
			[idOf(review), "pr"],
		]);

		// Each told value is an event: three PRs told to review, two passed on, two told to ship.
		const names = (span: ReadableSpan) => span.events.map((e) => e.name);
		expect(names(review).filter((n) => n === "told pr")).toHaveLength(3);
		expect(names(review).filter((n) => n === "sent passed")).toHaveLength(2);
		expect(names(ship).filter((n) => n === "told pr")).toHaveLength(2);

		// Under review: one machine span per PR, the draft's too, each with its Msgs and its
		// tags: the pull request, the commit, how it ended. Beside them, the queue they are worked off.
		const reviewed = childrenOf(inLine, review).filter((s) => s.name !== "queue");
		expect(reviewed.map(prOf).toSorted()).toEqual(["1", "2", "3"]);
		for (const machine of reviewed) {
			expect(names(machine)[0]).toBe("msg start");
			expect(machine.attributes["tea.pr"]).toBe(url(Number(prOf(machine))));
			expect(machine.attributes["tea.outcome"]).toBeTypeOf("string");
		}
		const draft = reviewed.find((s) => prOf(s) === "2");
		if (draft === undefined) throw new Error("no draft's span");
		expect(draft.attributes["tea.outcome"]).toBe("skip:draft");
		expect(red(draft)).toBe(false);

		// Under ship: only the two that passed. One would go in the merge queue; the other's
		// checks are stuck, so it ended there, red, with its outcome as the reason.
		const shipped = childrenOf(inLine, ship);
		expect(shipped.map(prOf).toSorted()).toEqual(["1", "3"]);
		const [going, stuck] = ["1", "3"].map((n) => shipped.find((s) => prOf(s) === n));
		if (going === undefined || stuck === undefined) throw new Error("no ship spans");
		expect(names(going)).toContain("would add to merge queue");
		expect(going.status.code).not.toBe(SpanStatusCode.ERROR);
		expect(stuck.status).toEqual({code: SpanStatusCode.ERROR, message: "stuck:checks_stuck"});

		// Names, tags and ids only. What was told on the line (the rubric folder, the flags'
		// values) is on the line's span and nowhere else; no PR body or reviewer text anywhere.
		const exported = (of: readonly ReadableSpan[]) =>
			JSON.stringify(of.map((s) => [s.name, s.attributes, s.events]));
		const rest = inLine.filter((s) => s !== root);
		expect(exported(rest)).not.toContain(RUBRICS);
		expect(exported(rest)).not.toContain("--budget");
		expect(exported([{...root, attributes: {}} as ReadableSpan])).not.toContain(RUBRICS);
		expect(exported(inLine)).not.toContain("Scripted: it does.");
	});
});

describe("tracing: off", () => {
	it("is off unless TSH_TRACE asks: no endpoint, so no provider and no exporter", () => {
		expect(endpointOf({})).toBeNull();
		expect(endpointOf({TSH_TRACE: ""})).toBeNull();
		expect(endpointOf({TSH_TRACE: "0"})).toBeNull();
		expect(endpointOf({TSH_TRACE: "1"})).toBe("http://localhost:4318");
		expect(endpointOf({TSH_TRACE: "http://collector:4318"})).toBe("http://collector:4318");
	});

	it("off as tsh runs it, the line does the same, and no OpenTelemetry tracer is there", async () => {
		const list = recordedGitHub();
		const prs = [1, 2, 3].map((n) => `pr=${url(n)}`).join(" ");
		const text = `review-scripted --rubrics ${RUBRICS} --model opus --effort medium --budget 1 ${prs} | ship --mode read`;
		const {said, agent, tracer} = await Effect.runPromise(
			Effect.gen(function* () {
				const {line} = yield* session(list, memoryStorage());
				return {
					said: yield* line(text),
					agent: yield* agentTrace("reviewer").pipe(Effect.withSpan("machine review")),
					tracer: yield* Effect.serviceOption(OtelTracer.OtelTracer),
				};
			}).pipe(Effect.scoped, Effect.withTracerEnabled(false)),
		);
		expect(said.status).toBe(0);
		expect(said.said.filter((l) => l.startsWith("ship found "))).toHaveLength(2);
		expect(agent).toBeNull();
		expect(Option.isNone(tracer)).toBe(true);
	});
});

describe("tracing: a kept job", () => {
	it("killed, then attached in the next tsh, goes on in the same trace", async () => {
		const storage = fileStorage(mkdtempSync(join(tmpdir(), "tsh-trace-")));
		const list = programList(SMALL);
		const first = memoryTracing();
		const run = await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard, started} = yield* session(list, storage);
				const id = (yield* line("tally &")).said[0]?.split(" ")[1] ?? "";
				yield* line("tell %1 add 2");
				yield* heard("[1] total 2");
				yield* started.stop;
				return id;
			}).pipe(Effect.scoped, Effect.provide(first.layer)),
		);
		const second = memoryTracing();
		await Effect.runPromise(
			Effect.gen(function* () {
				const {line, heard} = yield* session(list, storage);
				yield* line(`attach ${run} &`);
				yield* line("tell %1 add 3");
				yield* heard("[1] total 5");
			}).pipe(Effect.scoped, Effect.provide(second.layer)),
		);
		const typed = (spans: readonly ReadableSpan[], text: string) =>
			spans.filter((s) => s.attributes["tsh.line"] === text);
		const traceOf = (spans: readonly ReadableSpan[]) => spans.map((s) => s.spanContext().traceId);
		const named = (spans: readonly ReadableSpan[], name: string) =>
			spans.filter((s) => s.name === name && serviceOf(s) === "tally");

		// The trace is the run's, by its id: the same in both tsh, though nothing else is shared.
		const [started] = typed(first.spans, "tally &");
		const [attached] = typed(second.spans, `attach ${run} &`);
		if (started === undefined || attached === undefined) throw new Error("no line spans");
		expect([started.name, attached.name]).toEqual(["tally", "attach tally"]);
		expect(traceOf([started, attached])).toEqual([runTraceId(run), runTraceId(run)]);
		expect(traceOf(named(first.spans, "run"))).toEqual([runTraceId(run)]);
		expect(traceOf(named(second.spans, "run"))).toEqual([runTraceId(run)]);
		expect(traceOf(named(second.spans, "count"))).toEqual([runTraceId(run)]);
		// Each line's span is a root: the parent that names the trace is never looked for.
		expect([started.parentSpanContext, attached.parentSpanContext]).toEqual([undefined, undefined]);
	});
});
