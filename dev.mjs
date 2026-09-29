import { spawn } from "node:child_process";

const api = spawn(process.execPath, ["server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, PORT: "4178" },
});
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
  { stdio: "inherit", env: process.env },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  vite.kill();
  process.exitCode = code;
}
api.on("exit", (code) => {
  if (!stopping) {
    console.error("El servidor local se ha detenido.");
    stop(code || 1);
  }
});
vite.on("exit", (code) => {
  if (!stopping) stop(code || 0);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
