module.exports = {
  apps: [
    {
      name: "erp-api",
      script: "src/app.js",
      exec_mode: "cluster",
      // Demo sessions are process-local: keep one worker until a shared store is implemented.
      instances: 1,
      max_memory_restart: "1500M",
      kill_timeout: 10_000,
      wait_ready: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
