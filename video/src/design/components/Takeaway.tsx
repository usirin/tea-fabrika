import { useCurrentFrame } from "remotion";
import { enter, seconds } from "../timing";
import { color, font, type, weight } from "../tokens";
import { Rich } from "./Rich";

/** The one-line card that closes a chapter. Big, centred, nothing else on screen. */
export const Takeaway: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const l = enter(frame, 0);
  const t = enter(frame, seconds(0.25));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 220px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: type.label,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: color.accent,
          opacity: l,
          marginBottom: 44,
        }}
      >
        Takeaway
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: weight.semibold,
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          opacity: t,
          transform: `translateY(${(1 - t) * 20}px)`,
          textWrap: "balance",
        }}
      >
        <Rich text={text} />
      </div>
    </div>
  );
};
