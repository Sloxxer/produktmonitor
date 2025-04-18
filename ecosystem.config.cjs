// ecosystem.config.js  (CommonJS-version)
module.exports = {
    apps: [
      {
        name: 'product-stock-monitor',
        script: 'src/server.js',
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: 'smother-bullfrog-utter-winking-kudos-unshipped-qualified-secrecy-runny-daytime',
          PORT: 3010
        },
        max_restarts: 3,
        watch: false
      }
    ]
  };
  