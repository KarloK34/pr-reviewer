module.exports = {
  apps: [
    {
      name: "pr-reviewer",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "pr-reviewer-tunnel",
      script: "dist/tunnel-manager.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "128M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
