import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["192-168-1-46.nip.io", "192.168.1.46", "127.0.0.1.nip.io"],
    proxy: {
      "/auth/v1": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/rest/v1": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/functions/v1": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/storage/v1": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/realtime/v1": {
        target: "http://localhost:54321",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: ["192-168-1-46.nip.io", "192.168.1.46"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
