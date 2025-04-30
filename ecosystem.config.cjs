// ecosystem.config.js  (CommonJS-version)
module.exports = {
    apps: [
      {
        name: 'product-stock-monitor',
        script: 'src/server.js',
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: 'Change-this-to-a-super-safe-key',
          PORT: 3010
        },
        max_restarts: 3,
        watch: false
      }
    ]
  };
  