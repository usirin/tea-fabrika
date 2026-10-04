import { defineConfig } from "vitest/config";

// `fixtures/` holds toy repos with their own `node --test` files. They are the
// lane's subject, not this repo's tests.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
