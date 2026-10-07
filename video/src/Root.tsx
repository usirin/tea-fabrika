import { Composition, Series as Seq } from "remotion";
import { Ch01 } from "./chapters/Ch01";
import { Ch02 } from "./chapters/Ch02";
import { Ch03 } from "./chapters/Ch03";
import { Ch04 } from "./chapters/Ch04";
import { Ch05 } from "./chapters/Ch05";
import { Ch06 } from "./chapters/Ch06";
import { Ch07 } from "./chapters/Ch07";
import { Ch08 } from "./chapters/Ch08";
import { Ch09 } from "./chapters/Ch09";
import { Ch10 } from "./chapters/Ch10";
import { Intro } from "./chapters/Intro";
import { Outro } from "./chapters/Outro";
import { FPS, layout, seconds } from "./design";
import { CHAPTERS, type ChapterId, INTRO_SECONDS, OUTRO_SECONDS, TOTAL_SECONDS } from "./timeline";

const VIEWS: Record<ChapterId, React.FC> = { Ch01, Ch02, Ch03, Ch04, Ch05, Ch06, Ch07, Ch08, Ch09, Ch10 };

/** The order of the whole video, every length read from timeline.ts. */
const PARTS: readonly { id: string; seconds: number; View: React.FC }[] = [
  { id: "Intro", seconds: INTRO_SECONDS, View: Intro },
  ...CHAPTERS.map((c) => ({ id: c.id, seconds: c.seconds, View: VIEWS[c.id] })),
  { id: "Outro", seconds: OUTRO_SECONDS, View: Outro },
];

const FullSeries: React.FC = () => (
  <Seq>
    {PARTS.map(({ id, seconds: s, View }) => (
      <Seq.Sequence key={id} durationInFrames={seconds(s)} name={id}>
        <View />
      </Seq.Sequence>
    ))}
  </Seq>
);

const frame = { fps: FPS, width: layout.width, height: layout.height } as const;

export const Root: React.FC = () => (
  <>
    <Composition id="Series" component={FullSeries} durationInFrames={seconds(TOTAL_SECONDS)} {...frame} />
    {PARTS.map(({ id, seconds: s, View }) => (
      <Composition key={id} id={id} component={View} durationInFrames={seconds(s)} {...frame} />
    ))}
  </>
);
