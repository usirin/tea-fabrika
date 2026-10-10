type Opts<Ctx> = {
    msgs: readonly string[];
    ctx?: Ctx;
};
export type ReplayArg<Ctx> = Opts<Ctx>;
export declare function replay<Ctx>(opts: Opts<Ctx>): string;
export declare function run(n: number): number;
export declare function run(s: string): string;
export interface Machine {
    name: string;
    sep: ";{";
}
