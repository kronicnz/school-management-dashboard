import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["192-168-1-46.nip.io", "192.168.1.46"],
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
