module.exports = {
  apps: [
    {
      name: "erp-api",
      script: "src/app.js",
      exec_mode: "cluster",
      instances: Number(process.env.PM2_INSTANCES) || 4,
      max_memory_restart: "1500M",
      kill_timeout: 10_000,
      wait_ready: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
