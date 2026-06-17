import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: Vite serves the SPA on :5173 and proxies /api to the FastAPI backend on
// :8000, so the browser sees one origin (cookies + no CORS needed).
// Prod: `npm run build` emits dist/, which FastAPI serves (spec §6).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
