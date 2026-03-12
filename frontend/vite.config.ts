import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          const normalizedId = id.replace(/\\/g, "/");
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          const antdComponentMatch = normalizedId.match(/\/node_modules\/antd\/es\/([^/]+)\//);
          if (antdComponentMatch?.[1]) {
            return `antd-${antdComponentMatch[1]}`;
          }

          if (normalizedId.includes("/node_modules/antd/")) {
            return "antd-vendor";
          }

          if (normalizedId.includes("/node_modules/@ant-design/")) {
            return "ant-design-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
