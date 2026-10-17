import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runTraceId} from "@demlik/tea/otel";
import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {Duration, Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../code-host-github.ts";
import {ear} from "../program/ear.ts";
import {start, tell} from "../program/program.ts";
import {memoryStorage, type Storage} from "../program/storage.ts";
import {fileStorage} from "../program/storage-node.ts";
import {CodeHost} from "../services.ts";
import {changed, HEADS, RUBRICS, recorded, recordedGh} from "../stages/review/scripted.ts";
import type {ShipFacts} from "../stages/ship/facts.ts";
import {agentTrace} from "../trace/agent.ts";
import {endpointOf, memoryTracing} from "../trace/otel.ts";
import {fabrikaEntries} from "./fabrika.ts";
import {JobStorage, type ProgramList, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// Tracing, as the owner uses it: one tsh line, one trace, read back as a
// tree. Spans are kept in memory here (`memoryTracing`); `TSH_TRACE` sends the
// same spans to Jaeger.

let runs = 0;
/** One tsh on a storage; `line` tells it a line and waits for its `ready`. */
const session = (list: ProgramList, storage: Storage) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		runs += 1;
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: `tsh:trace-${runs}`, storage},
		).pipe(Effect.provideService(Programs, list), Effect.provideService(JobStorage, storage));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		const line = (text: string) =>
			Effect.gen(function* () {
				const from = printed.values.length;
				expect(tell(started.run, "line", text)).toBe("queued");
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
			}).pipe(Effect.timeout(Duration.seconds(5)), Effect.orDie);
		return {started, line, heard};
	});

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;
const clear: ShipFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: "passed",
	reviewKinds: [],
	checks: "green",
	mergeable: "clean",
	comments: [],
};
/** The recorded pull request, open at the head that merged; a draft when `draft`. */
const opened = (draft: boolean) =>
	changed(recorded("change-final.json"), (repo) => {
		repo.pullRequest.state = "OPEN";
		repo.pullRequest.isDraft = draft;
		repo.pullRequest.headRefOid = HEADS.final;
	});

/** GitHub, read from recordings. Pull request 2 is a draft: review skips it, and passes nothing on. */
const recordedGitHub = () => {
	const host = Layer.succeed(CodeHost, {
		prFacts: () => Effect.succeed(clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened(pr === url(2))});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.never,
	});
	return programList([...SMALL, ...fabrikaEntries({own: [], reviewers: []}, () => host)]);
};

const idOf = (span: ReadableSpan) => span.spanContext().spanId;
const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;
const childrenOf = (spans: readonly ReadableSpan[], parent: ReadableSpan) =>
	spans.filter((s) => parentOf(s) === idOf(parent));
const prOf = (span: ReadableSpan) => span.attributes["vcs.change.id"];

/** The spans as a tree, one line each, children indented under their parent, events after `·`. */
const drawn = (spans: readonly ReadableSpan[]): string => {
	const ids = new Set(spans.map(idOf));
	const line = (span: ReadableSpan, depth: number): string[] => {
		const pr = prOf(span) === undefined ? "" : ` #${prOf(span)}`;
		const events =
			span.events.length === 0 ? "" : `  · ${span.events.map((e) => e.name).join(", ")}`;
		const links = span.links.length === 0 ? "" : `  ↔ ${span.links.length} link`;
		return [
			`${"  ".repeat(depth)}${span.name}${pr}${links}${events}`,
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
	it("one review | ship line is one trace: the line, a run per program, linked, and each PR's machines under them", async () => {
		const {spans, layer} = memoryTracing();
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
		const line = drawn(spans.filter((s) => s.name !== "run tsh"));
		expect(line.split("\n").map((l) => l.replace(/ {2}[↔·].*$/, ""))).toEqual([
			text,
			"  run ship",
			"    machine ship #1",
			"      cmd ship_facts",
			"    machine ship #3",
			"      cmd ship_facts",
			"  run review-scripted",
			"    machine review #1",
			"      cmd review_pack",
			"      sub review_run",
			"    machine review #2",
			"      cmd review_pack",
			"    machine review #3",
			"      cmd review_pack",
			"      sub review_run",
		]);

		// The line is the root of its trace, and everything under it is in that trace.
		const roots = spans.filter((s) => s.name === text);
		expect(roots).toHaveLength(1);
		const [root] = roots;
		if (root === undefined) throw new Error("no line span");
		const trace = root.spanContext().traceId;
		const inLine = spans.filter((s) => s.spanContext().traceId === trace);
		expect(spans.filter((s) => s.name !== "run tsh" && s.spanContext().traceId !== trace)).toEqual(
			[],
		);
		expect(new Set(inLine.map(idOf)).has(parentOf(root) ?? "")).toBe(false);

		// One run span per program, each a child of the line, linked to each other both ways.
		const children = childrenOf(inLine, root).map((s) => s.name);
		expect(children.toSorted()).toEqual(["run review-scripted", "run ship"]);
		const review = inLine.find((s) => s.name === "run review-scripted");
		const ship = inLine.find((s) => s.name === "run ship");
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

		// Under review: one machine span per PR, the draft's too, each with its Cmds and Msgs.
		const reviewed = childrenOf(inLine, review).filter((s) => s.name === "machine review");
		expect(reviewed.map(prOf).toSorted()).toEqual(["1", "2", "3"]);
		for (const machine of reviewed) {
			expect(names(machine)[0]).toBe("msg start");
			expect(childrenOf(inLine, machine).some((s) => s.name.startsWith("cmd "))).toBe(true);
		}
		const draft = reviewed.find((s) => prOf(s) === "2");
		const passed = reviewed.find((s) => prOf(s) === "1");
		if (draft === undefined || passed === undefined) throw new Error("no machine spans");
		// The draft is read and skipped: no reviewer is run for it.
		expect(childrenOf(inLine, draft).map((s) => s.name)).not.toContain("sub review_run");
		expect(childrenOf(inLine, passed).map((s) => s.name)).toContain("sub review_run");

		// Under ship: only the two that passed. The draft never appears there.
		const shipped = childrenOf(inLine, ship).filter((s) => s.name === "machine ship");
		expect(shipped.map(prOf).toSorted()).toEqual(["1", "3"]);
		for (const machine of shipped) {
			expect(childrenOf(inLine, machine).map((s) => s.name)).toEqual(["cmd ship_facts"]);
			expect(names(machine)).toContain("cmd ship_enqueue");
		}

		// Names, tags and ids only: no PR body or reviewer text in any attribute or event.
		const exported = JSON.stringify(
			inLine.map((s) => [s.attributes, s.events.map((e) => e.attributes)]),
		);
		expect(exported).not.toContain("Scripted: it does.");
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
				yield* heard("[1] 2");
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
				yield* heard("[1] 5");
			}).pipe(Effect.scoped, Effect.provide(second.layer)),
		);
		const traceOf = (spans: readonly ReadableSpan[], name: string) =>
			spans.filter((s) => s.name === name).map((s) => s.spanContext().traceId);

		// The trace is the run's, by its id: the same in both tsh, though nothing else is shared.
		expect(traceOf(first.spans, "tally &")).toEqual([runTraceId(run)]);
		expect(traceOf(first.spans, "run tally")).toEqual([runTraceId(run)]);
		expect(traceOf(second.spans, `attach ${run} &`)).toEqual([runTraceId(run)]);
		expect(traceOf(second.spans, "run tally")).toEqual([runTraceId(run)]);
		expect(traceOf(second.spans, "machine count")).toEqual([runTraceId(run)]);
	});
});
