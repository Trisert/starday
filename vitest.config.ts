import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "@": path.resolve(__dirname, "./src"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["src/lib/**/*.test.ts", "src/app/api/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["src/app/**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["node_modules", ".next", "coverage"],
      reporter: ["text", "lcov", "html"],
      thresholds: {
        statements: 30,
        branches: 30,
      },
    },
  },
});
