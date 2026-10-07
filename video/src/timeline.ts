/**
 * The one table of durations. Root.tsx sequences the full video from it, each
 * chapter's own composition takes its length from it, and the chapter runner
 * fails the render if a chapter's scenes do not fit their row.
 *
 * Changing a row changes the whole video's length: do it here only, and
 * update STORYBOARD.md in the same commit.
 */

export type ChapterId = "Ch01" | "Ch02" | "Ch03" | "Ch04" | "Ch05" | "Ch06" | "Ch07" | "Ch08" | "Ch09" | "Ch10";

export type ChapterRow = {
  readonly id: ChapterId;
  readonly number: number;
  /** The post's title, as the header card shows it. */
  readonly title: string;
  readonly seconds: number;
};

export const INTRO_SECONDS = 20;
export const OUTRO_SECONDS = 20;

export const CHAPTERS: readonly ChapterRow[] = [
  { id: "Ch01", number: 1, title: "Fabrika was v3. This is v4.", seconds: 55 },
  { id: "Ch02", number: 2, title: "Meeting Jev: when unsure means the question was bad", seconds: 60 },
  { id: "Ch03", number: 3, title: "A judge that cannot add", seconds: 60 },
  { id: "Ch04", number: 4, title: "The agents had a shell", seconds: 55 },
  { id: "Ch05", number: 5, title: "Tests decide, not models", seconds: 55 },
  { id: "Ch06", number: 6, title: "Rebuilding fabrika one step at a time", seconds: 60 },
  { id: "Ch07", number: 7, title: "Cheap enough to read everything", seconds: 55 },
  { id: "Ch08", number: 8, title: "The twenty dollar lesson", seconds: 40 },
  { id: "Ch09", number: 9, title: "Working with the agent, not through it", seconds: 45 },
  { id: "Ch10", number: 10, title: "Knobs in a file, systems with SDKs", seconds: 50 },
];

export const chapter = (id: ChapterId): ChapterRow => {
  const row = CHAPTERS.find((c) => c.id === id);
  if (!row) throw new Error(`No chapter ${id} in the timeline`);
  return row;
};

export const TOTAL_SECONDS = INTRO_SECONDS + OUTRO_SECONDS + CHAPTERS.reduce((s, c) => s + c.seconds, 0);
