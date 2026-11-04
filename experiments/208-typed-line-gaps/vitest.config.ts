import {defineConfig} from "vitest/config";

// The root config runs no experiment, so this one runs 208's laws alone.
export default defineConfig({test: {include: ["experiments/208-typed-line-gaps/*.test.ts"]}});
