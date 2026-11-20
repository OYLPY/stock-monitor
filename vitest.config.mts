import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/ai-evals/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/quant-audit/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "src/domain/primitives.ts",
        "src/features/market-calendar/market-calendar.ts",
        "src/features/risk/checker.ts",
        "src/features/risk/drawdown.ts",
        "src/features/quant/indicators.ts",
        "src/features/evidence/repository.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
