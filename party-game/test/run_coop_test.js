const { spawn } = require("child_process");
const path = require("path");

const server = spawn("node", [path.join(__dirname, "..", "server", "index.js")], {
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));

setTimeout(() => {
  const testFile = process.argv[2] || "test_coop.js";
  const test = spawn("node", [path.join(__dirname, testFile)], { stdio: "inherit" });
  test.on("exit", (code) => {
    server.kill();
    process.exit(code);
  });
}, 800);
