import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "test-data-server",
      configureServer(server) {
        server.middlewares.use("/test-data", (req, res, next) => {
          const filename = req.url?.replace(/^\//, "");
          if (!filename) return next();
          const filePath = path.resolve(__dirname, "tools/test_data", filename);
          try {
            const data = fs.readFileSync(filePath);
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", data.length);
            res.end(data);
          } catch {
            next();
          }
        });
      },
    },
  ],
  base: "/afminism/",
});
