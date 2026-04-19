import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // Make VITE_ env vars available at build time
  define: {},
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: mode !== "production",
  },
}));
