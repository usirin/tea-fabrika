import { useCurrentFrame } from "remotion";
import {
  Chapter,
  CodeCard,
  type Scene,
  color,
  enter,
  font,
  layout,
  progress,
  seconds,
  type,
  weight,
} from "../design";

/** Part 8: The twenty dollar lesson. See STORYBOARD.md, "Ch08". */

type ReceiptLine = { label: string; value: string };

/** A till receipt: a few lines, a dashed rule, and the total. */
const Receipt: React.FC<{
  heading: string;
  lines: readonly ReceiptLine[];
  total: string;
  at: number;
  accent?: boolean;
}> = ({ heading, lines, total, at, accent }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  const t = enter(frame, at + seconds(0.9));
  const text = (strong = false): React.CSSProperties => ({
    fontFamily: font.mono,
    fontSize: type.label + 2,
    color: strong ? color.text : color.textMuted,
    fontVariantNumeric: "tabular-nums",
  });
  return (
    <div
      style={{
        width: 620,
        background: color.surface,
        border: `2px solid ${accent ? color.accentLine : color.line}`,
        borderRadius: layout.radius,
        padding: "40px 48px 44px",
        opacity: s,
        transform: `translateY(${(1 - s) * 24}px)`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: type.label - 2,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: color.textMuted,
          marginBottom: 32,
        }}
      >
        {heading}
      </div>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 18,
            opacity: enter(frame, at + seconds(0.3) + i * 6),
          }}
        >
          <span style={text()}>{l.label}</span>
          <span style={text(true)}>{l.value}</span>
        </div>
      ))}
      <div style={{ borderTop: `3px dashed ${color.line}`, margin: "28px 0 26px" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", opacity: t }}>
        <span style={text()}>total</span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 60,
            fontWeight: weight.medium,
            letterSpacing: "-0.02em",
            color: accent ? color.accent : color.text,
          }}
        >
          {total}
        </span>
      </div>
    </div>
  );
};

const Receipts: React.FC = () => (
  <div style={{ display: "flex", gap: 120, alignItems: "flex-start" }}>
    <Receipt
      heading="whole-package run"
      lines={[
        { label: "calls", value: "36,171" },
        { label: "each call", value: "~13,000 tokens" },
      ]}
      total="about $20"
      at={seconds(0.2)}
      accent
    />
    <Receipt
      heading="duplicate check"
      lines={[
        { label: "calls", value: "35,374" },
        { label: "each call", value: "< 2,000 tokens" },
      ]}
      total="$1 or $2"
      at={seconds(2.2)}
    />
  </div>
);

/** The old helper's retries: wait 1, 2, 4, 8 seconds, then give up. A 402 never gets better. */
const RetryLadder: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const steps = [
    { label: "wait 1 s", h: 50 },
    { label: "wait 2 s", h: 90 },
    { label: "wait 4 s", h: 140 },
    { label: "wait 8 s", h: 200 },
  ];
  const stepW = 220;
  const step = seconds(0.45);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
      {steps.map((s, i) => {
        const o = enter(frame, at + i * step);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: o }}>
            <div style={{ fontFamily: font.mono, fontSize: type.label - 2, color: color.textFaint, marginBottom: 12 }}>
              402
            </div>
            <div
              style={{
                width: stepW,
                height: s.h * progress(frame, at + i * step, seconds(0.6)),
                background: color.surfaceRaised,
                border: `2px solid ${color.line}`,
                borderRadius: 12,
              }}
            />
            <div style={{ marginTop: 18, fontFamily: font.mono, fontSize: type.label, color: color.text }}>
              {s.label}
            </div>
          </div>
        );
      })}
      <div
        style={{
          width: stepW,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: enter(frame, at + 4 * step),
        }}
      >
        <div style={{ fontSize: type.body, fontWeight: weight.semibold, color: color.textMuted }}>give up</div>
        <div style={{ marginTop: 18, fontFamily: font.mono, fontSize: type.label, color: color.textMuted }}>
          5 tries
        </div>
      </div>
    </div>
  );
};

const PaymentRequired: React.FC = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 64 }}>
    <CodeCard code="Error: Jev answered 402" lang="text" fontSize={44} highlight={[1]} start={seconds(0.1)} />
    <RetryLadder at={seconds(1.2)} />
  </div>
);

/** The two-line sum that should have come before the run, typed out under the struck estimate. */
const TheSum: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const strike = progress(frame, seconds(1.6), seconds(0.6));
  const line = (at: number): React.CSSProperties => {
    const o = enter(frame, at);
    return { opacity: o, transform: `translateX(${(1 - o) * -16}px)` };
  };
  const mono: React.CSSProperties = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ width: 1280, display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ ...line(seconds(0.2)), ...mono, fontSize: type.body + 4, color: color.textMuted }}>
        <span style={{ position: "relative", display: "inline-block" }}>
          estimate: $0.60
          <span
            style={{
              position: "absolute",
              left: -8,
              top: "52%",
              height: 4,
              width: `calc(${strike * 100}% + 16px)`,
              background: color.textMuted,
              borderRadius: 2,
            }}
          />
        </span>
      </div>
      <div style={{ ...line(second + seconds(0.1)), ...mono, fontSize: type.body + 4, color: color.text }}>
        36,171 × 13,000 tokens ≈ 470 million
      </div>
      <div style={{ ...line(second + seconds(1.2)), ...mono, fontSize: type.body + 4, color: color.accent }}>
        470 million × $0.042 per million ≈ $20
      </div>
      <div
        style={{
          ...line(second + seconds(2.6)),
          marginTop: 16,
          paddingTop: 32,
          borderTop: `2px solid ${color.line}`,
          fontSize: type.label + 4,
          color: color.textMuted,
        }}
      >
        The real bill that day: <span style={{ ...mono, color: color.text }}>$21.31</span> for{" "}
        <span style={{ ...mono, color: color.text }}>508 million</span> tokens.
      </div>
    </div>
  );
};

const BUDGET = `// Jev bills by the token, not the call.
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 5_000);
const DOLLARS_PER_TOKEN = 0.042 / 1_000_000;
const MAX_DOLLARS = Number(process.env.MAX_DOLLARS ?? 5);`;

const Budget: React.FC = () => {
  const frame = useCurrentFrame();
  const o = enter(frame, seconds(1.6));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 56 }}>
      <CodeCard
        code={BUDGET}
        title="experiments/jev.ts · commits bb6217a, 6acce3e"
        fontSize={34}
        highlight={[2, 4]}
        start={0}
      />
      <div
        style={{
          opacity: o,
          transform: `translateY(${(1 - o) * 12}px)`,
          fontFamily: font.mono,
          fontSize: type.label,
          color: color.textMuted,
          border: `2px solid ${color.line}`,
          borderRadius: 14,
          padding: "14px 28px",
        }}
      >
        on exit, a receipt: calls · tokens · dollars
      </div>
    </div>
  );
};

const RULES = [
  { text: "Estimate before you run", kind: "habit" },
  { text: "Sample before you scale", kind: "habit" },
  { text: "Send the least text", kind: "habit" },
  { text: "Put the budget in the helper", kind: "code" },
] as const;

const FourRules: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width: 1200, display: "flex", flexDirection: "column", gap: 24 }}>
      {RULES.map((r, i) => {
        const o = enter(frame, seconds(0.2) + i * seconds(0.7));
        const code = r.kind === "code";
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 36,
              padding: "24px 40px",
              borderRadius: layout.radius,
              background: code ? color.accentSoft : color.surface,
              border: `2px solid ${code ? color.accent : color.line}`,
              opacity: o,
              transform: `translateY(${(1 - o) * 14}px)`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: type.label + 4, color: color.textFaint, width: 40 }}>
              {i + 1}
            </span>
            <span
              style={{ flex: 1, fontSize: type.body, fontWeight: weight.medium, color: code ? color.accent : color.text }}
            >
              {r.text}
            </span>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: type.label - 2,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: code ? color.accent : color.textMuted,
              }}
            >
              {r.kind}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: ["36,171 calls cost about $20. Later, 35,374 calls cost a dollar or two."],
    visual: () => <Receipts />,
  },
  {
    captions: ["402 means payment required. The helper retried it anyway, five times per call."],
    visual: () => <PaymentRequired />,
  },
  {
    captions: [
      "The estimate said $0.60. Jev bills by the token, and each call carried a whole file.",
      "36,171 calls × 13,000 tokens × $0.042 per million ≈ $20.",
    ],
    hold: 0.4,
    visual: (cues) => <TheSum second={cues.at(1)} />,
  },
  {
    captions: ["Now the helper stops at 5,000 calls or $5, and prints a receipt."],
    visual: () => <Budget />,
  },
  {
    captions: ["Estimate first. Sample before you scale. Send the least text."],
    hold: 0.6,
    visual: () => <FourRules />,
  },
];

export const Ch08: React.FC = () => <Chapter id="Ch08" scenes={scenes} takeaway="Price the *input*, not the call." />;
