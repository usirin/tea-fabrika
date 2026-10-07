import { Sequence, useCurrentFrame } from "remotion";
import {
  BarChart,
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
  seconds,
  stage,
  type,
  weight,
} from "../design";
import { Card, CardSub, CardTitle, Kicker, Layer, Pill, fadeOutAt } from "./Ch02/kit";

/** Part 4: The agents had a shell. See STORYBOARD.md, "Ch04". */

const PromptVsCommand: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 64 }}>
    <Card at={seconds(0.1)} muted width={460} height={200}>
      <Kicker text="the prompt" style={{ marginBottom: 16 }} />
      <CardTitle>You cannot run commands.</CardTitle>
    </Card>
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Kicker text="what the agents ran" at={seconds(0.9)} accent />
      <CodeCard code="$ git show HEAD:slugify.test.js" lang="sh" start={seconds(0.9)} fontSize={40} />
    </div>
  </div>
);

const Flag: React.FC<{ flag: string; does: string; at: number; accent?: boolean }> = ({ flag, does, at, accent }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, opacity: s }}>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 44,
          fontWeight: weight.medium,
          color: accent ? color.accent : color.text,
          fontVariantLigatures: "none",
        }}
      >
        {flag}
      </span>
      <span style={{ fontSize: type.label + 4, color: color.textMuted }}>{does}</span>
    </div>
  );
};

const Flags: React.FC<{ second: number }> = ({ second }) => (
  <div style={{ position: "relative", width: stage.width, height: stage.height }}>
    <div style={{ position: "absolute", left: 0, right: 0, top: 10, display: "flex", justifyContent: "center", gap: 120 }}>
      <Flag flag="--allowedTools" does="pre-approves" at={seconds(0.1)} />
      <Flag flag="--tools" does="takes away" at={seconds(0.8)} accent />
    </div>
    <div style={{ position: "absolute", left: 50, top: 170 }}>
      <BarChart
        title="sessions that looked at git or the tests"
        max={100}
        labelWidth={360}
        start={second}
        bars={[
          { label: "test-writer", value: (46 / 63) * 100, display: "46 of 63", accent: true },
          { label: "triage", value: (50 / 73) * 100, display: "50 of 73" },
          { label: "builder", value: (1 / 40) * 100, display: "1 of 40" },
        ]}
      />
    </div>
  </div>
);

const FIX = `// \`--tools\` is what takes the other tools away. \`--allowedTools\`
// alone only pre-approves: with it the agent kept a shell, and used
// \`git show\` to dig files out of history that had been removed
// from its folder.
"--tools", ...ask.tools,
"--allowedTools", ...ask.tools,`;

const TheFix: React.FC = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
    <CodeCard code={FIX} title="the fix · commit 46bd5a4" fontSize={32} highlight={[5]} start={seconds(0.1)} />
    <Pill text="6 experiments rerun" at={seconds(2.2)} accent />
  </div>
);

/** A test card's rows: a short line per test, visible or behind frosted glass. */
const TestRows: React.FC<{ n: number; hidden?: boolean; at: number }> = ({ n, hidden, at }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          style={{
            height: 16,
            width: `${70 + ((i * 37) % 30)}%`,
            borderRadius: 8,
            background: hidden ? color.line : color.textFaint,
            opacity: progress(frame, at + i * 2, seconds(0.3)),
          }}
        />
      ))}
    </div>
  );
};

const ExamCards: React.FC = () => (
  <div style={{ display: "flex", gap: 60, alignItems: "stretch" }}>
    <Card at={seconds(0.1)} width={560} style={{ justifyContent: "flex-start" }}>
      <Kicker text="practice" />
      <CardTitle>Visible tests</CardTitle>
      <CardSub>one per rule · the builder sees them</CardSub>
      <TestRows n={3} at={seconds(0.5)} />
    </Card>
    <Card at={seconds(0.8)} width={560} lit={1} style={{ justifyContent: "flex-start" }}>
      <Kicker text="exam" accent />
      <CardTitle>Hidden tests</CardTitle>
      <CardSub>three more per rule · never shown to the builder</CardSub>
      <TestRows n={9} hidden at={seconds(1.2)} />
    </Card>
  </div>
);

const Exam: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <Layer opacity={fadeOutAt(frame, second - seconds(0.2))}>
        <ExamCards />
      </Layer>
      <Layer opacity={progress(frame, second, seconds(0.4))}>
        <CounterRow
          start={second}
          stagger={seconds(0.6)}
          items={[
            { to: 36, suffix: " of 36", size: 110, label: "cheats passed visible tests" },
            { to: 27, size: 110, label: "caught by hidden tests", accent: true },
            { to: 0, suffix: " of 90", size: 110, label: "false alarms on correct code" },
          ]}
        />
      </Layer>
    </div>
  );
};

const LEAK: FlowNode[] = [
  { id: "fail", label: "hidden test fails", x: 190, y: 300, w: 360 },
  { id: "out", label: "test output", sub: "expected 5400", x: 700, y: 300, w: 380, h: 140, accent: true },
  { id: "builder", label: "builder", sub: "tries again", x: 1420, y: 300, w: 320 },
];

const Leak: React.FC = () => (
  <FlowDiagram
    nodes={LEAK}
    start={seconds(0.2)}
    stagger={seconds(0.5)}
    edges={[
      { from: "fail", to: "out" },
      { from: "out", to: "builder", dashed: true, accent: true, label: "the answer key" },
    ]}
  />
);

/** Real section titles from experiments/README.md. */
const OLD_LINES = [
  "## 9. The three rules, given to the writer",
  "## 10. Bad tests written to fool the judge",
  "## 12. The enricher's own criteria",
];

const CORRECTIONS = [
  { what: "9. good tests", before: "48 of 48", after: "48 of 48" },
  { what: "11. cheats caught", before: "24 of 33", after: "27 of 36" },
];

/** The experiment log: old lines stay, a correction slides in between them. */
const Log: React.FC = () => {
  const frame = useCurrentFrame();
  const open = progress(frame, seconds(0.9), seconds(0.8));
  const body = enter(frame, seconds(1.4));
  const lineStyle: React.CSSProperties = {
    fontFamily: font.mono,
    fontSize: type.label,
    color: color.textMuted,
    padding: "10px 0",
  };
  return (
    <Card at={0} width={1200} style={{ padding: "28px 48px", justifyContent: "flex-start" }}>
      <Kicker text="experiments/README.md" style={{ marginBottom: 10 }} />
      <div style={lineStyle}>{OLD_LINES[0]}</div>
      <div style={lineStyle}>{OLD_LINES[1]}</div>
      <div style={{ height: 300 * open, overflow: "hidden" }}>
        <div
          style={{
            margin: "12px 0",
            borderLeft: `6px solid ${color.accent}`,
            background: color.accentSoft,
            borderRadius: 8,
            padding: "18px 28px",
            opacity: body,
          }}
        >
          <div style={{ fontSize: type.label + 6, fontWeight: weight.semibold, color: color.accent }}>
            16. Correction: the agents had a shell
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 220px", rowGap: 10, marginTop: 18 }}>
            {["", "before", "after"].map((h) => (
              <div key={h} style={{ fontFamily: font.mono, fontSize: type.label - 4, color: color.textMuted }}>
                {h}
              </div>
            ))}
            {CORRECTIONS.flatMap((c) => [
              <div key={`${c.what}w`} style={{ fontSize: type.label + 2, color: color.text }}>
                {c.what}
              </div>,
              <div key={`${c.what}b`} style={{ fontFamily: font.mono, fontSize: type.label + 2, color: color.textMuted }}>
                {c.before}
              </div>,
              <div key={`${c.what}a`} style={{ fontFamily: font.mono, fontSize: type.label + 2, color: color.text }}>
                {c.after}
              </div>,
            ])}
          </div>
        </div>
      </div>
      <div style={lineStyle}>{OLD_LINES[2]}</div>
    </Card>
  );
};

const scenes: Scene[] = [
  {
    captions: ["The prompt said you cannot run commands. The agents ran this anyway."],
    hold: 0.6,
    visual: () => <PromptVsCommand />,
  },
  {
    captions: [
      "`--allowedTools` only pre-approves tools. It doesn't take the shell away.",
      "The test-writer looked at git or the tests in 46 of 63 sessions.",
    ],
    visual: (cues) => <Flags second={cues.at(1)} />,
  },
  {
    captions: ["The fix: `--tools`, which names the only tools an agent has. Six experiments were rerun."],
    hold: 0.6,
    visual: () => <TheFix />,
  },
  {
    captions: [
      "Practice questions and an exam. Hidden tests catch code that only learned the examples.",
      "All 36 hand-written cheats passed the visible tests. The hidden tests caught 27.",
    ],
    visual: (cues) => <Exam second={cues.at(1)} />,
  },
  {
    captions: ["The second leak: a failing hidden test prints what it expected. The answer key, with the grade."],
    hold: 0.4,
    visual: () => <Leak />,
  },
  {
    captions: ["We kept the wrong lines in the log, and added the correction next to them."],
    hold: 0.6,
    visual: () => <Log />,
  },
];

export const Ch04: React.FC = () => (
  <Chapter
    id="Ch04"
    scenes={scenes}
    takeaway="A prompt is not a fence. Check what the agent *did*, in its session log."
  />
);
