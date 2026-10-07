import { useCurrentFrame } from "remotion";
import {
  BarChart,
  Chapter,
  CodeCard,
  FlowDiagram,
  type FlowNode,
  type Scene,
  color,
  enter,
  font,
  row,
  seconds,
  stage,
  type,
  weight,
} from "../design";
import { Kicker } from "./Ch05/kit";

/** Part 6: Rebuilding fabrika one step at a time. See STORYBOARD.md, "Ch06". */

type MapRow = { part: string; who: string; built: "built" | "half" | "not built" };

/** The review map from post 6: one row per thing fabrika's review checks, and who decides it. */
const REVIEW_MAP: readonly MapRow[] = [
  { part: "Each criterion is met", who: "code", built: "built" },
  { part: "No edits to the locked tests", who: "code", built: "built" },
  { part: "No changes outside the ticket", who: "code", built: "built" },
  { part: "Extra changes, listed", who: "code and the router", built: "built" },
  { part: "Tests green on the real commit", who: "code", built: "half" },
  { part: "Extra problems a reader spots", who: "an agent", built: "not built" },
  { part: "Comments and docs gone stale", who: "an agent", built: "not built" },
  { part: "Owner comments that change a rule", who: "Jev reads, a person rules", built: "not built" },
];

const ReviewMap: React.FC = () => {
  const frame = useCurrentFrame();
  const cell = (text: string, w: number, style?: React.CSSProperties) => (
    <div style={{ width: w, whiteSpace: "nowrap", ...style }}>{text}</div>
  );
  return (
    <div style={{ width: 1400 }}>
      <div
        style={{
          display: "flex",
          fontFamily: font.mono,
          fontSize: type.label,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: color.textMuted,
          paddingBottom: 14,
          borderBottom: `2px solid ${color.line}`,
          opacity: enter(frame, 0),
        }}
      >
        {cell("what review checks", 760)}
        {cell("who decides", 640, { color: color.accent })}
      </div>
      {REVIEW_MAP.map((r, i) => {
        const s = enter(frame, seconds(0.4 + i * 0.22));
        const faint = r.built === "not built";
        return (
          <div
            key={r.part}
            style={{
              display: "flex",
              alignItems: "center",
              height: 64,
              fontSize: type.label + 2,
              borderBottom: `1px solid ${color.surfaceRaised}`,
              opacity: s * (faint ? 0.42 : 1),
              transform: `translateX(${(1 - s) * -16}px)`,
            }}
          >
            {cell(r.part, 760, { color: color.text })}
            {cell(r.who, 460, { color: color.textMuted })}
            {cell(r.built === "built" ? "" : r.built, 180, {
              fontFamily: font.mono,
              fontSize: type.label,
              color: color.textFaint,
              textAlign: "right",
            })}
          </div>
        );
      })}
    </div>
  );
};

/** The review machine: reviewer finds, code checks the quote, the router sorts, the machine decides. */
const reviewMachine = (second: number): FlowNode[] => [
  { id: "reviewer", label: "reviewer agent", sub: "finds", x: 190, y: 220, w: 320 },
  { id: "code", label: "code", sub: "checks the quote", x: 590, y: 220, w: 320 },
  { id: "router", label: "router", sub: "sorts", x: 990, y: 220, w: 320, at: second },
  { id: "machine", label: "machine", sub: "pass or fail", x: 1400, y: 220, w: 320, accent: true, at: second + seconds(0.4) },
  { id: "person", label: "a person", sub: "what the router is unsure of", x: 990, y: 500, w: 460, at: second + seconds(0.8) },
];

/** Three review rounds; the last one is frozen. */
const Rounds: React.FC = () => {
  const frame = useCurrentFrame();
  const lock = enter(frame, seconds(1.6));
  const nodes: FlowNode[] = [
    { id: "r1", label: "round 1", sub: "findings go back", x: 210, y: 330, w: 380, h: 200 },
    { id: "r2", label: "round 2", sub: "findings go back", x: 730, y: 330, w: 380, h: 200 },
    {
      id: "r3",
      label: "round 3 · frozen",
      sub: "new findings filed, not blocking",
      x: 1320,
      y: 330,
      w: 540,
      h: 200,
      accent: true,
    },
  ];
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <FlowDiagram
        nodes={nodes}
        edges={[
          { from: "r1", to: "r2" },
          { from: "r2", to: "r3" },
        ]}
        start={seconds(0.2)}
        stagger={seconds(0.45)}
      />
      {/* A padlock over the frozen round. */}
      <svg
        width={64}
        height={76}
        viewBox="0 0 64 76"
        style={{
          position: "absolute",
          left: 1320 - 32,
          top: 140,
          opacity: lock,
          transform: `translateY(${(1 - lock) * -14}px)`,
        }}
      >
        <path d="M16 34 V22 a16 16 0 0 1 32 0 V34" fill="none" stroke={color.accent} strokeWidth={6} />
        <rect x={6} y={32} width={52} height={40} rx={8} fill={color.accent} />
        <circle cx={32} cy={50} r={5} fill={color.bg} />
      </svg>
    </div>
  );
};

const APPROVE = `/**
 * \`approve\` names the commit it approves;
 * an answer naming any other leaves ship parked.
 */
readonly approve:
  | { readonly kind: "approve"; readonly head: string }
  | Drop;`;

const STEPS = row(
  [
    { id: "report", label: "report", sub: "by hand" },
    { id: "triage", label: "triage", sub: "proven" },
    { id: "plan", label: "plan", sub: "not built" },
    { id: "build", label: "build", sub: "proven" },
    { id: "review", label: "review", sub: "proven" },
    { id: "ship", label: "ship", sub: "proven" },
  ],
  { w: 210, y: stage.height / 2 + 40 },
).map((n) => (n.id === "plan" ? { ...n, muted: true } : n));

const scenes: Scene[] = [
  {
    captions: ["New ideas, or rebuilding fabrika? As a rebuild, we were about a quarter done."],
    hold: 0.3,
    visual: () => (
      <BarChart
        title="how far along, by finish line"
        max={1}
        start={seconds(0.2)}
        stagger={seconds(0.6)}
        labelWidth={600}
        bars={[
          { label: "code-driven loop, proven", value: 0.92, display: "nearly done" },
          { label: "fabrika, rebuilt", value: 0.25, display: "a quarter", accent: true },
        ]}
      />
    ),
  },
  {
    captions: ["So we drew a map: one row per thing fabrika's review checks, and who decides it."],
    hold: 0.6,
    visual: () => <ReviewMap />,
  },
  {
    captions: [
      "Review became its own machine. The agent only finds. Code checks every quote is real.",
      "A router sorts each finding. The machine says pass or fail.",
    ],
    visual: (cues) => (
      <FlowDiagram
        nodes={reviewMachine(cues.at(1))}
        start={seconds(0.2)}
        stagger={seconds(0.6)}
        edges={[
          { from: "reviewer", to: "code" },
          { from: "code", to: "router" },
          { from: "router", to: "machine", accent: true },
          { from: "router", to: "person", dashed: true },
        ]}
      />
    ),
  },
  {
    captions: [
      "A fresh reviewer forgets what a person decided. A matcher catches the repeats.",
      "28 of 36 right, 0 wrong matches. Every miss fell on the safe side.",
    ],
    visual: (cues) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <BarChart
          title="the matcher · 12 findings, asked 3 times"
          max={36}
          start={seconds(0.3)}
          bars={[
            { label: "right", value: 28, display: "28 of 36" },
            { label: "missed a repeat", value: 8, display: "8" },
            { label: "wrong match", value: 0, display: "0", accent: true },
          ]}
        />
        <Kicker text="a miss is routed as new: one more question to a person" at={cues.at(1) + seconds(0.6)} />
      </div>
    ),
  },
  {
    captions: ["A reviewer always finds one more thing. So the list freezes on the last round."],
    visual: () => <Rounds />,
  },
  {
    captions: ["Ship waits for a person to approve one named commit. An agent never gives it."],
    hold: 0.4,
    visual: () => <CodeCard code={APPROVE} title="ship's answer type" highlight={[6]} fontSize={34} start={0} />,
  },
  {
    captions: ["Four of six steps proven, on two toys. None has run on a real issue yet."],
    hold: 0.6,
    visual: () => (
      <div style={{ position: "relative", width: stage.width, height: stage.height }}>
        <div style={{ position: "absolute", top: 120, width: "100%", textAlign: "center" }}>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: type.heading,
              fontWeight: weight.medium,
              color: color.accent,
            }}
          >
            4 of 6
          </span>
          <Kicker text="proven, on two toys" style={{ marginTop: 12 }} />
        </div>
        <div style={{ position: "absolute", inset: 0 }}>
          <FlowDiagram
            nodes={STEPS}
            edges={STEPS.slice(1).map((n, i) => ({ from: STEPS[i]!.id, to: n.id }))}
            start={seconds(0.3)}
            stagger={seconds(0.2)}
          />
        </div>
      </div>
    ),
  },
];

export const Ch06: React.FC = () => (
  <Chapter id="Ch06" scenes={scenes} takeaway="Copy which steps exist. Decide how each works *on its merits*." />
);
