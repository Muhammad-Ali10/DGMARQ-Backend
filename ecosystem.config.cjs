module.exports = {
  apps: [
    {
      name: "dgmarq-api",
      script: "./src/index.js",
      instances: "max", // Use all CPU cores
      exec_mode: "cluster",
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "development",
        PORT: 5000,
      },
      env_staging: {
        NODE_ENV: "staging",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: true,
      // Logging
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Auto-restart on file changes (dev only)
      watch: false,
      // Restart policy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 1000,
    },
    {
      name: "dgmarq-worker",
      script: "./src/jobs/worker.js",
      instances: 2,
      exec_mode: "cluster",
      max_memory_restart: "300M",
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
