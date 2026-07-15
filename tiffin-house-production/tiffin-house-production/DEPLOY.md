# 🚀 Tiffin House — Deployment Guide
### For Hostinger VPS / Shared Node.js Hosting / Any Linux Server

---

## What's Inside This ZIP

```
tiffin-house-production/
├── server.js            ← Entire backend bundled into one file (Node.js)
├── public/              ← Built React frontend (HTML + CSS + JS)
├── uploads/             ← Food image uploads land here (auto-created)
├── logs/                ← PM2 logs land here (auto-created)
├── ecosystem.config.cjs ← PM2 process config
├── package.json         ← Backend dependencies only
├── .env.example         ← Copy to .env and fill in your values
├── db-setup.sql         ← Run once to create all tables
└── DEPLOY.md            ← This file
```

---

## Prerequisites on Your Server

| Requirement | Version | Install |
|---|---|---|
| Node.js | 18 or 20 LTS | `nvm install 20` |
| npm | 9+ | included with Node |
| PM2 | latest | `npm install -g pm2` |
| PostgreSQL | 14+ | Hostinger hPanel → Databases |

---

## Step-by-Step Deployment

### 1 — Upload files to your server

**Option A — Hostinger File Manager**
Upload the ZIP via hPanel → File Manager → public_html (or your Node.js app folder) → Extract.

**Option B — SFTP (FileZilla / WinSCP)**
Connect with your Hostinger SFTP credentials and upload the extracted folder.

**Option C — SSH + SCP**
```bash
scp -r tiffin-house-production/ user@your-server-ip:/var/www/tiffin-house/
```

---

### 2 — SSH into your server

```bash
ssh user@your-server-ip
cd /var/www/tiffin-house          # wherever you uploaded
```

---

### 3 — Install Node.js dependencies

```bash
npm install --omit=dev
```

---

### 4 — Create the PostgreSQL database

In Hostinger hPanel → Databases → PostgreSQL → create a new database and note:
- Host, Port, Database name, Username, Password

Then run the setup SQL:
```bash
psql "postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DB" -f db-setup.sql
```

Or paste the contents of `db-setup.sql` into Hostinger's phpPgAdmin query tool.

---

### 5 — Configure environment variables

```bash
cp .env.example .env
nano .env           # fill in DATABASE_URL, SESSION_SECRET, PORT, etc.
```

**Minimum required values:**
```
DATABASE_URL=postgresql://user:pass@localhost:5432/tiffin_house
SESSION_SECRET=your_long_random_secret_here
PORT=3001
NODE_ENV=production
```

---

### 6 — Start the app with PM2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save                   # persist across reboots
pm2 startup                # follow the printed command to enable autostart
```

Check it's running:
```bash
pm2 status
pm2 logs tiffin-house      # live logs
```

---

### 7 — Point your domain (Nginx reverse proxy)

Install Nginx if not present:
```bash
sudo apt install nginx -y
```

Create a site config:
```bash
sudo nano /etc/nginx/sites-available/tiffin-house
```

Paste this (replace `yourdomain.com` and port `3001` if different):
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Max upload size for food images
    client_max_body_size 10M;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/tiffin-house /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 8 — Enable HTTPS (free SSL via Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot auto-renews — your site will have HTTPS for free.

---

### 9 — Point your domain DNS

In your domain registrar (or Hostinger hPanel → DNS Zone Editor):

| Type | Name | Value |
|---|---|---|
| A | @ | your-server-IP |
| A | www | your-server-IP |

DNS propagation takes 5–30 minutes.

---

## Hostinger Shared Node.js Hosting (simpler)

If you are on Hostinger **shared Node.js hosting** (not a VPS):

1. Upload files to the Node.js app folder shown in hPanel
2. Set environment variables in hPanel → Node.js → Environment Variables
3. Set **Entry point** to `server.js`
4. Set **Node.js version** to 20 LTS
5. Click **Restart** — Hostinger handles the port and proxy for you
6. No Nginx/PM2 needed — hPanel manages it

---

## Admin Panel

Visit `https://yourdomain.com/admin`

Default credentials:
- **Phone:** `0000000000`
- **Password:** `Admin@123`

⚠️ **Change the admin password immediately after first login** via Admin → Settings.

---

## Updating the Site Later

To update just the backend:
```bash
# Upload new server.js, then:
pm2 restart tiffin-house
```

To update menu images or content:
- Upload to `uploads/` folder OR use the Admin Panel → Menu → Edit dish → Upload image

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to DB` | Check DATABASE_URL in .env; ensure PostgreSQL allows remote connections |
| `Port already in use` | Change PORT in .env and ecosystem.config.cjs |
| `404 on page refresh` | Nginx config missing — see Step 7 |
| `Uploads folder missing` | `mkdir -p uploads logs` then `pm2 restart tiffin-house` |
| App crashes on start | `pm2 logs tiffin-house` to see the error |

---

## File Structure After Deployment

```
/var/www/tiffin-house/
├── server.js          ← never edit this
├── public/            ← never edit this (rebuild from source to update)
├── uploads/           ← food images — back this up!
├── logs/
├── .env               ← your secrets — never share this
├── package.json
└── ecosystem.config.cjs
```

Back up `.env` and `uploads/` regularly — everything else can be redeployed from source.
