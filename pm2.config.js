const dotenv = require("dotenv");
const path = require("path");

// Load .env so PM2 passes all variables to child processes
const envFile = dotenv.config({ path: path.resolve(__dirname, ".env") });
const env = {
  NODE_ENV: "production",
  ...(envFile.parsed || {}),
};

module.exports = {
  apps: [
    {
      name: "pr-reviewer",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      max_memory_restart: "256M",
      out_file: "./logs/pr-reviewer-out.log",
      error_file: "./logs/pr-reviewer-error.log",
      merge_logs: true,
      time: true,
      env,
    },
    {
      name: "pr-reviewer-tunnel",
      script: "dist/tunnel-manager.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: "128M",
      out_file: "./logs/pr-reviewer-tunnel-out.log",
      error_file: "./logs/pr-reviewer-tunnel-error.log",
      merge_logs: true,
      time: true,
      env,
    },
  ],
};
