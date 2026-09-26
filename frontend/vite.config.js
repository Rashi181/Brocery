import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://127.0.0.1:8002",
        changeOrigin: true,
      },
    },
  },
});
