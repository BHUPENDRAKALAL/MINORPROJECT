import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port; `/api` is forwarded to the local API process in development.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Playwright writes traces and screenshots inside this folder during e2e runs; watching them slowed every request.
    watch: { ignored: ["**/e2e-results/**", "**/e2e-report/**", "**/test-results/**"] },
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4001", ws: true },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
