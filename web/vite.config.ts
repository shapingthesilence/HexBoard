import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const baseByMode: Record<string, string> = {
  "github-pages": "/HexBoard/",
  "github-pages-main": "/HexBoard/",
  "github-pages-development": "/HexBoard/development/"
};

export default defineConfig(({ mode }) => ({
  base: baseByMode[mode] ?? "/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
}));
