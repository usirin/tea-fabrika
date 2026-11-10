// One line of text, for a screen or a log: no text an agent or a ticket chose may move the cursor,
// color the screen, or start a line of its own. One rule, for a table's cells (./table.ts), the
// host's log lines (../mcp/serve.ts) and the why an agent gives for a stop (../mcp/stop.ts).
//
//   oneLine("Login\nfails  \u001b[31m")   // "Login fails \u{fffd}[31m"
//   isOneLine("wrong ticket")            // true
//   isOneLine("wrong ticket\n[1] done")  // false

/**
 * A text as one line: every run of white space one space, as gh's `RemoveExcessiveWhitespace`
 * does to a title, and any other control character a replacement character.
 */
export const oneLine = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\p{Cc}/gu, "\u{fffd}");

/**
 * The text holds no control character (newlines, carriage returns and tabs among them) and no
 * line or paragraph separator: nothing `oneLine` would turn into a space or a replacement.
 */
export const isOneLine = (text: string): boolean => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text);
