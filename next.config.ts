import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the repository's own agent instructions.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
