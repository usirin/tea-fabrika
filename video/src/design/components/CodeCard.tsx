import { Fragment } from "react";
import { useCurrentFrame } from "remotion";
import { enter, progress, seconds } from "../timing";
import { color, font, layout, type } from "../tokens";

export type CodeLang = "ts" | "js" | "toml" | "sh" | "text";

const commentStart: Record<CodeLang, readonly string[]> = {
  ts: ["//", "/**", "*", "*/"],
  js: ["//", "/**", "*", "*/"],
  toml: ["#"],
  sh: ["#"],
  text: [],
};

/** A tiny highlighter: comments faint, strings in a soft accent, the rest plain. */
const Line: React.FC<{ text: string; lang: CodeLang }> = ({ text, lang }) => {
  const trimmed = text.trimStart();
  if (commentStart[lang].some((c) => trimmed.startsWith(c))) {
    return <span style={{ color: color.textFaint }}>{text}</span>;
  }
  const marker = lang === "toml" || lang === "sh" ? " #" : " //";
  const cut = text.indexOf(marker);
  const code = cut >= 0 ? text.slice(0, cut) : text;
  const comment = cut >= 0 ? text.slice(cut) : "";
  const parts = code.split(/("[^"]*"|`[^`]*`)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^["`]/.test(p) ? (
          <span key={i} style={{ color: "#E9C98A" }}>
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
      {comment ? <span style={{ color: color.textFaint }}>{comment}</span> : null}
    </>
  );
};

/**
 * A code or TOML snippet in a card. Lines type on top to bottom; `highlight`
 * lines (1-based) get an accent bar once the card is in. Keep it to about 12
 * lines and 60 characters wide so it reads on a phone.
 */
export const CodeCard: React.FC<{
  code: string;
  lang?: CodeLang;
  /** Shown in the card's top bar, e.g. the file name. */
  title?: string;
  highlight?: readonly number[];
  start?: number;
  /** Frames between lines appearing. */
  lineStagger?: number;
  /** Frame the highlight lights up at. Defaults to after the last line. */
  highlightAt?: number;
  fontSize?: number;
}> = ({ code, lang = "ts", title, highlight = [], start = 0, lineStagger = 2, highlightAt, fontSize = type.code }) => {
  const frame = useCurrentFrame();
  const lines = code.replace(/\n$/, "").split("\n");
  const card = enter(frame, start);
  const lit = progress(frame, highlightAt ?? start + seconds(0.4) + lines.length * lineStagger, seconds(0.5));
  return (
    <div
      style={{
        background: color.surface,
        border: `2px solid ${color.line}`,
        borderRadius: layout.radius,
        overflow: "hidden",
        opacity: card,
        transform: `translateY(${(1 - card) * 20}px)`,
        maxWidth: 1500,
      }}
    >
      {title ? (
        <div
          style={{
            padding: "18px 32px",
            borderBottom: `2px solid ${color.line}`,
            fontFamily: font.mono,
            fontSize: type.label - 4,
            color: color.textMuted,
            background: color.surfaceRaised,
          }}
        >
          {title}
        </div>
      ) : null}
      <div style={{ padding: "28px 0" }}>
        {lines.map((l, i) => {
          const on = highlight.includes(i + 1);
          const shown = progress(frame, start + seconds(0.3) + i * lineStagger, seconds(0.3));
          return (
            <div
              key={i}
              style={{
                fontFamily: font.mono,
                fontSize,
                lineHeight: 1.5,
                whiteSpace: "pre",
                fontVariantLigatures: "none",
                fontFeatureSettings: '"liga" 0, "calt" 0',
                padding: "0 40px",
                color: color.text,
                opacity: shown * (highlight.length > 0 && !on ? 1 - 0.45 * lit : 1),
                borderLeft: `6px solid ${on ? `rgba(232, 180, 79, ${lit})` : "transparent"}`,
                background: on ? `rgba(232, 180, 79, ${0.08 * lit})` : "transparent",
              }}
            >
              {l.length > 0 ? <Line text={l} lang={lang} /> : " "}
            </div>
          );
        })}
      </div>
    </div>
  );
};
