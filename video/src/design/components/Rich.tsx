import { Fragment } from "react";
import { color } from "../tokens";

/**
 * Text with light emphasis: wrap words in *asterisks* to paint them in the
 * accent. Wrap them in `backticks` to set them in the mono font.
 */
export const Rich: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*[^*]+\*|`[^`]+`)/g).filter((p) => p.length > 0);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("*") && p.endsWith("*")) {
          return (
            <span key={i} style={{ color: color.accent }}>
              {p.slice(1, -1)}
            </span>
          );
        }
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <span key={i} style={{ fontFamily: "JetBrains Mono", fontSize: "0.88em", fontVariantLigatures: "none" }}>
              {p.slice(1, -1)}
            </span>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
};

/** The text as it reads, without emphasis marks. */
export const plain = (text: string): string => text.replace(/[*`]/g, "");
