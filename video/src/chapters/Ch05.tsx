import { useCurrentFrame } from "remotion";
import {
  BarChart,
  Chapter,
  CodeCard,
  Counter,
  type Scene,
  color,
  enter,
  font,
  progress,
  seconds,
  type,
  weight,
} from "../design";
import { Card, Kicker, Pill, Stat } from "./Ch05/kit";

/** Part 5: Tests decide, not models. See STORYBOARD.md, "Ch05". */

const EXAMPLE = `{ call: 'slugify("A b")', result: '"a-b"' }`;
const GENERATED = `test("slugify A b", () => {
  assert.deepStrictEqual(slugify("A b"), "a-b");
});`;

/** A short downward arrow with a label beside it. */
const DownArrow: React.FC<{ at: number; label: string }> = ({ at, label }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, seconds(0.6));
  const h = 90;
  return (
    <div style={{ position: "relative", height: h + 20, width: 600, display: "flex", justifyContent: "center" }}>
      <svg width={40} height={h + 20} style={{ overflow: "visible" }}>
        <line x1={20} y1={8} x2={20} y2={8 + (h - 16) * p} stroke={color.textFaint} strokeWidth={3} strokeLinecap="round" />
        <polygon points={`20,${h + 8} 10,${h - 10} 30,${h - 10}`} fill={color.textFaint} opacity={p > 0.9 ? 1 : 0} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 340,
          top: h / 2 - 10,
          fontFamily: font.mono,
          fontSize: type.label,
          color: color.textMuted,
          whiteSpace: "nowrap",
          opacity: enter(frame, at + seconds(0.3)),
        }}
      >
        {label}
      </div>
    </div>
  );
};

const ISSUES = [
  { label: "#516", fit: 18, of: 32 },
  { label: "#576", fit: 11, of: 22 },
  { label: "#565", fit: 7, of: 22 },
  { label: "#568", fit: 0, of: 15 },
  { label: "#567", fit: 0, of: 16 },
  { label: "#529", fit: 0, of: 15 },
  { label: "#569", fit: 0, of: 8 },
];

/** Two counts of the same till: triage's example against a reference built from the rules alone. */
const TwoCashiers: React.FC = () => {
  const frame = useCurrentFrame();
  const clash = enter(frame, seconds(1.4));
  const till = (who: string, value: string, at: number, accent: boolean) => (
    <Card at={at} accent={accent} style={{ width: 660, padding: "24px 36px" }}>
      <div style={{ fontSize: type.label, color: color.textMuted, marginBottom: 12, whiteSpace: "nowrap" }}>{who}</div>
      <div style={{ fontFamily: font.mono, fontSize: 34, color: color.text, whiteSpace: "nowrap" }}>
        parseDuration("1.5h") → <span style={{ color: accent ? color.accent : color.text }}>{value}</span>
      </div>
    </Card>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {till("triage's example", "4500", 0, false)}
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 64,
            fontWeight: weight.medium,
            color: color.textMuted,
            opacity: clash,
            transform: `scale(${0.8 + 0.2 * clash})`,
          }}
        >
          ≠
        </div>
        {till("a throwaway build, from the rules only", "5400", seconds(0.5), true)}
      </div>
      <BarChart
        title="wrong examples caught, of 20 planted"
        start={seconds(2.2)}
        max={20}
        width={1400}
        labelWidth={480}
        bars={[
          { label: "throwaway reference", value: 20, display: "20 of 20", accent: true },
          { label: "builder's contradiction", value: 19, display: "19 of 20" },
        ]}
      />
      <div
        style={{
          fontFamily: font.mono,
          fontSize: type.label,
          color: color.textMuted,
          opacity: enter(frame, seconds(3.4)),
        }}
      >
        false alarms on correct examples: 0
      </div>
    </div>
  );
};

const UNWRITTEN = ["seconds", "spaces", "upper case", "decimals", "a bare number", "the order of units"];

/** The duration ticket: 3 rules written, and the 6 the hidden tests needed that nobody wrote down. */
const Ceiling: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: 64, alignItems: "flex-start" }}>
      <Card at={0} accent style={{ width: 560, padding: "32px 40px", whiteSpace: "nowrap" }}>
        <Kicker text="the duration ticket" accent />
        <div style={{ fontSize: type.body, fontWeight: weight.semibold, margin: "20px 0 28px" }}>triage wrote 3 rules</div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 22,
              width: [400, 330, 370][i],
              borderRadius: 11,
              background: color.line,
              marginBottom: 22,
              opacity: enter(frame, seconds(0.3 + i * 0.2)),
            }}
          />
        ))}
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
        <div
          style={{
            fontSize: type.body,
            fontWeight: weight.semibold,
            opacity: enter(frame, seconds(1.0)),
            marginBottom: 8,
          }}
        >
          the hidden tests hold 8
        </div>
        <Kicker text="never written down" at={seconds(1.4)} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, width: 860 }}>
          {UNWRITTEN.map((u, i) => (
            <Pill key={u} text={u} faint mono={false} at={seconds(1.8 + i * 0.45)} />
          ))}
        </div>
      </div>
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: [
      "With a passing test in front of it, the judge was right 117 of 117 times.",
      "So write the tests first, and let them say when the work is done.",
    ],
    visual: () => (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          alignItems: "start",
          width: "100%",
          whiteSpace: "nowrap",
        }}
      >
        <Counter to={117} suffix=" of 117" label="right, with a passing test" accent start={seconds(0.2)} size={116} />
        <Stat text="about half" label="right, no test, on broken code" at={seconds(0.9)} size={116} />
      </div>
    ),
  },
  {
    captions: [
      "Triage writes each rule with an example: a call and its exact result.",
      "Code turns each example into a test. No agent writes it, no judge checks it.",
    ],
    hold: 0.4,
    visual: (cues) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <CodeCard code={EXAMPLE} title="an example, written by triage" start={seconds(0.2)} fontSize={36} />
        <DownArrow at={cues.at(1)} label="code, not an agent" />
        <CodeCard
          code={GENERATED}
          title="the test, generated"
          start={cues.at(1) + seconds(0.5)}
          highlight={[2]}
          fontSize={32}
        />
      </div>
    ),
  },
  {
    captions: [
      "On seven real issues, only 36 of 130 criteria fit a call and a result.",
      "The rest park as `unchecked`, with a reason. Not a quiet pass.",
    ],
    hold: 0.4,
    visual: (cues) => (
      <div style={{ display: "flex", alignItems: "center", gap: 40, width: "100%" }}>
        <div
          style={{
            width: 560,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 48,
            whiteSpace: "nowrap",
          }}
        >
          <Counter to={36} suffix=" of 130" label="criteria fit a call and a result" size={96} start={seconds(0.1)} />
          <Pill text="the rest → unchecked" accent at={cues.at(1)} />
        </div>
        <BarChart
          title="criteria that fit, seven demlik issues"
          start={seconds(0.6)}
          stagger={seconds(0.18)}
          max={1}
          width={1000}
          labelWidth={150}
          bars={ISSUES.map((i) => ({ label: i.label, value: i.fit / i.of, display: `${i.fit} of ${i.of}` }))}
        />
      </div>
    ),
  },
  {
    captions: ["A throwaway build from the rules alone caught 20 of 20 planted wrong examples."],
    hold: 1.0,
    visual: () => <TwoCashiers />,
  },
  {
    captions: ["The limit: a test only checks a rule somebody wrote down. The ticket is the ceiling."],
    lead: 0.3,
    hold: 0.6,
    visual: () => <Ceiling />,
  },
];

export const Ch05: React.FC = () => (
  <Chapter id="Ch05" scenes={scenes} takeaway={'Settle "is it right" by *running code*. Spend your effort on the ticket.'} />
);
