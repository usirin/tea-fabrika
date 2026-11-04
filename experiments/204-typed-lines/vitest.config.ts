import {defineConfig} from "vitest/config";

// The root config runs no experiment, so this one runs 204's law alone.
export default defineConfig({test: {include: ["experiments/204-typed-lines/*.test.ts"]}});
