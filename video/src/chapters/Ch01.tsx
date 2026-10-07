import { useCurrentFrame } from "remotion";
import {
  Chapter,
  CodeCard,
  CounterRow,
  FlowDiagram,
  type FlowNode,
  type Scene,
  color,
  enter,
  font,
  progress,
  row,
  seconds,
  stage,
  type,
  weight,
} from "../design";

/** Part 1: Fabrika was v3. This is v4. See STORYBOARD.md, "Ch01". */

const SIX_STEPS = row(
  [
    { id: "report", label: "report" },
    { id: "triage", label: "triage" },
    { id: "plan", label: "plan" },
    { id: "build", label: "build" },
    { id: "review", label: "review" },
    { id: "ship", label: "ship" },
  ],
  { w: 196, y: stage.height / 2 + 20 },
);

const Kicker: React.FC<{ text: string; at?: number; style?: React.CSSProperties }> = ({ text, at = 0, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type.label,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: color.textMuted,
        opacity: enter(frame, at),
        ...style,
      }}
    >
      {text}
    </div>
  );
};

const RowLabel: React.FC<{ text: string; y: number; at: number; accent?: boolean }> = ({ text, y, at, accent }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: y - 30,
        fontFamily: font.mono,
        fontSize: 48,
        fontWeight: weight.medium,
        color: accent ? color.accent : color.textFaint,
        opacity: enter(frame, at),
      }}
    >
      {text}
    </div>
  );
};

const FLIP_NODES: FlowNode[] = [
  { id: "prose", label: "An agent reads prose", sub: "runs the loop", x: 560, y: 150, w: 440, muted: true, at: 0 },
  { id: "cli", label: "CLI checks", sub: "exact answers", x: 1250, y: 150, w: 340, muted: true, at: seconds(0.3) },
  { id: "machine", label: "A state machine", sub: "code runs the loop", x: 560, y: 470, w: 440, accent: true, at: seconds(1.4) },
  { id: "agents", label: "Agents", sub: "write", x: 1250, y: 390, w: 340, h: 104, at: seconds(1.8) },
  { id: "jev", label: "Jev", sub: "answers yes/no", x: 1250, y: 560, w: 340, h: 104, at: seconds(2.1) },
];

const TEA_LOOP: FlowNode[] = [
  { id: "msg", label: "Msg", sub: "something happened", x: 300, y: 346, w: 330 },
  { id: "update", label: "update", sub: "a pure function", x: 800, y: 130, w: 330, accent: true },
  { id: "model", label: "Model + Cmds", sub: "new state, work as data", x: 1300, y: 346, w: 360 },
  { id: "runtime", label: "runtime", sub: "does the work", x: 800, y: 562, w: 330 },
];

const FIRST_UPDATE = `update: {
  start: (s, m) =>
    s.phase === "idle"
      ? [{ phase: "building", issue: m.issue, attempt: 1 },
         [build({ issue: m.issue, feedback: null })]]
      : stay(s),
  build_ok: (s) =>
    s.phase === "building"
      ? [{ phase: "checking", issue: s.issue, attempt: s.attempt },
         [check({})]]
      : stay(s),
}`;

const OWNERS: FlowNode[] = [
  { id: "machine", label: "The machine", sub: "owns the loop and the facts", x: 270, y: 346, w: 480, h: 220, accent: true },
  { id: "agents", label: "Agents", sub: "own the writing", x: 800, y: 346, w: 480, h: 220 },
  { id: "jev", label: "Jev", sub: "owns narrow yes/no calls", x: 1330, y: 346, w: 480, h: 220 },
];

/** Experiment 23 on one line: a turn, the kill, the second turn in the same conversation. */
const KillTimeline: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const left = 200;
  const width = stage.width - 400;
  const y = 420;
  // Real times from Claude's log: 03:41:57 and 03:42:05. SIGINT came 5 s into the first turn.
  const span = 8;
  const xAt = (s: number) => left + (s / span) * width;
  const line = progress(frame, 0, seconds(1.2));
  const marks = [
    { s: 0, top: "turn 1", bottom: "03:41:57", at: seconds(0.3), accent: false },
    { s: 5, top: "SIGINT", bottom: "+5 s", at: seconds(1.0), accent: true },
    { s: 8, top: "turn 2", bottom: "03:42:05", at: second, accent: false },
  ];
  const state = enter(frame, second + seconds(0.6));
  const dot = 28;
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <div
        style={{
          position: "absolute",
          left,
          top: y - 1.5,
          height: 3,
          width: width * line,
          background: color.line,
          borderRadius: 2,
        }}
      />
      {marks.map((m, i) => {
        const o = enter(frame, m.at);
        const x = xAt(m.s);
        return (
          <div key={i} style={{ opacity: o }}>
            <div
              style={{
                position: "absolute",
                left: x - 150,
                width: 300,
                top: y - 96,
                textAlign: "center",
                fontFamily: font.mono,
                fontSize: type.label + 4,
                fontWeight: weight.medium,
                color: m.accent ? color.accent : color.text,
              }}
            >
              {m.top}
            </div>
            <div
              style={{
                position: "absolute",
                left: x - dot / 2,
                top: y - dot / 2,
                width: dot,
                height: dot,
                boxSizing: "border-box",
                borderRadius: dot / 2,
                background: m.accent ? color.accent : color.bg,
                border: `3px solid ${m.accent ? color.accent : color.textMuted}`,
                transform: `scale(${0.6 + 0.4 * o})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x - 150,
                width: 300,
                top: y + 44,
                textAlign: "center",
                fontFamily: font.mono,
                fontSize: type.label,
                color: color.textMuted,
              }}
            >
              {m.bottom}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 130,
          textAlign: "center",
          opacity: state,
          transform: `translateY(${(1 - state) * 12}px)`,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: type.label + 2,
            color: color.text,
            background: color.accentSoft,
            border: `2px solid ${color.accentLine}`,
            borderRadius: 14,
            padding: "14px 28px",
          }}
        >
          state.json: phase "building", same conversation id
        </span>
      </div>
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: ["Fabrika is my agent pipeline. An issue goes through six steps."],
    hold: 0.6,
    visual: () => (
      <div style={{ position: "relative", width: stage.width, height: stage.height }}>
        <Kicker text="fabrika · v3" style={{ position: "absolute", top: 150, width: "100%", textAlign: "center" }} />
        <div style={{ position: "absolute", inset: 0 }}>
          <FlowDiagram
            nodes={SIX_STEPS}
            edges={SIX_STEPS.slice(1).map((n, i) => ({ from: SIX_STEPS[i]!.id, to: n.id }))}
            start={seconds(0.3)}
            stagger={seconds(0.22)}
          />
        </div>
      </div>
    ),
  },
  {
    captions: ["29 skills, 8 agents, and an operator skill of about 2,500 lines.", "The prose is the program. The model is the CPU."],
    visual: () => (
      <CounterRow
        start={seconds(0.2)}
        items={[
          { to: 29, label: "skills" },
          { to: 8, label: "agents" },
          { to: 2500, label: "lines in the operator's skill", accent: true },
        ]}
      />
    ),
  },
  {
    captions: ["Flip it: code drives the loop, and calls the model."],
    hold: 0.6,
    visual: () => (
      <div style={{ position: "relative", width: stage.width, height: stage.height }}>
        <RowLabel text="v3" y={150} at={0} />
        <RowLabel text="v4" y={470} at={seconds(1.4)} accent />
        <div style={{ position: "absolute", inset: 0 }}>
          <FlowDiagram
            nodes={FLIP_NODES}
            edges={[
              { from: "prose", to: "cli" },
              { from: "machine", to: "agents", accent: true },
              { from: "machine", to: "jev", accent: true },
            ]}
          />
        </div>
      </div>
    ),
  },
  {
    captions: ["It's built on tea, my brother's library: the Elm Architecture in TypeScript.", "The machine never does anything. It only decides."],
    visual: () => (
      <FlowDiagram
        nodes={TEA_LOOP}
        start={seconds(0.3)}
        stagger={seconds(0.35)}
        edges={[
          { from: "msg", to: "update", bend: -50 },
          { from: "update", to: "model", bend: -50 },
          { from: "model", to: "runtime", bend: -50 },
          { from: "runtime", to: "msg", bend: -50 },
        ]}
      />
    ),
  },
  {
    captions: ["First commit, 28 minutes in: a whole lane, 8 tests, no model, no network."],
    hold: 0.8,
    visual: () => (
      <CodeCard
        code={FIRST_UPDATE}
        title="the first update · commit 6e9a510"
        fontSize={30}
        highlight={[5, 10]}
        start={0}
      />
    ),
  },
  {
    captions: ["The machine owns the loop. Agents write. Jev answers narrow yes/no calls."],
    visual: () => <FlowDiagram nodes={OWNERS} start={seconds(0.2)} stagger={seconds(0.45)} />,
  },
  {
    captions: [
      "Experiment 23 killed a real build 5 seconds in.",
      "Run again, it picked up the same conversation. The machine knew where it was.",
    ],
    visual: (cues) => <KillTimeline second={cues.at(1)} />,
  },
];

export const Ch01: React.FC = () => (
  <Chapter id="Ch01" scenes={scenes} takeaway="Put the loop in code. Keep the model for the *open-ended* parts." />
);
