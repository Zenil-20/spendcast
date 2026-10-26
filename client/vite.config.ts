import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In development, API calls go to the Express server through this proxy, so the
// browser sees one origin and no CORS setup is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://localhost:5000",
          changeOrigin: true
        }
      }
    }
  };
});
