// PM2 process config — used on your VPS / Hostinger Node.js server
// Start with:  pm2 start ecosystem.config.cjs
// Save:        pm2 save
// Auto-start:  pm2 startup   (follow the printed command)

module.exports = {
  apps: [
    {
      name       : 'tiffin-house',
      script     : 'server.js',       // the compiled single-file bundle
      interpreter: 'node',
      env_production: {
        NODE_ENV: 'production',
        PORT    : 3001,               // change if Hostinger assigns a different port
      },
      instances  : 1,
      autorestart: true,
      watch      : false,
      max_memory_restart: '512M',
      error_file : './logs/err.log',
      out_file   : './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
