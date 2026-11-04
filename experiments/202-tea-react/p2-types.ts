import type {EffectRuntime} from "@demlik/tea/effect";
import {useRuntime} from "@demlik/tea/react";
declare const rt: EffectRuntime<{count: number}, {type: "inc"}>;
export const tryIt = () => useRuntime(rt);
