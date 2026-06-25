// PM2 process config for the King WMS API.
// Run from this folder:  pm2 start ecosystem.config.cjs
// Reads apps/backend/.env (DATABASE_URL, SESSION_SECRET, PORT, CORS_ORIGIN).
// Uses tsx as the loader so the TypeScript sources run without a build step,
// matching the King One backend deployment pattern.
module.exports = {
  apps: [
    {
      name: "king-wms-api",
      cwd: __dirname,
      script: "node",
      args: "--import tsx src/index.ts",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
