import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.PROMPTDOCK_VITE_PORT ?? 5173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PROMPTDOCK_VITE_PORT 必须是有效端口号。");
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
