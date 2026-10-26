// Launches the whole Pointbreak Rides stack for local testing:
//   - API           http://localhost:3003
//   - Rider web app http://localhost:8082
//   - Driver app    http://localhost:8083/?app=driver
//
// Usage: npm run dev   (from the pointbreak-rides-fiji folder)
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const serverDir = path.join(root, "server");
const mobileDir = path.join(root, "mobile");

const children = [];
let shuttingDown = false;

function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const tag = (line) => `[${name}] ${line}`;
  child.stdout.on("data", (d) => process.stdout.write(tag(String(d))));
  child.stderr.on("data", (d) => process.stderr.write(tag(String(d))));
  child.on("exit", (code) => {
    if (!shuttingDown) console.log(`[${name}] exited with code ${code}`);
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { child.kill(); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting Pointbreak Rides Fiji…");
run("api", "node", ["index.js"], serverDir);
run("rider", "npx", ["--yes", "serve@14.2.1", "-l", "8082", "dist"], mobileDir);
run("driver", "npx", ["--yes", "serve@14.2.1", "-l", "8083", "dist"], mobileDir);

console.log("");
console.log("  API          http://localhost:3003");
console.log("  Rider app    http://localhost:8082");
console.log("  Driver app   http://localhost:8083/?app=driver");
console.log("");
console.log("Press Ctrl+C to stop everything.");
