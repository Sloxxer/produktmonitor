# Product Stock Monitor 🛒

En minimal Node app som övervakar produkt‑URL:er och pingar en Discord‑webhook
så fort varan går att beställa ("Lägg i varukorg" / `InStock` / Webhallen‑API).

---
## Snabbstart lokalt
```bash
git clone https://github.com/<user>/product-stock-monitor.git
cd product-stock-monitor
npm install              # bygger sqlite3 om ingen pre‑build finns
cp .env.example .env     # fyll SESSION_SECRET och PORT
npm run dev              # http://localhost:3010
```

---
## Production deploy på Ubuntu 22 + PM2

```bash
# 1  Installera Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 make g++ git sqlite3

# 2  Klona repo
sudo mkdir -p /opt
sudo git clone https://github.com/<user>/product-stock-monitor.git /opt/produktmonitor
cd /opt/produktmonitor

# 3  Konfig & beroenden
cp .env.example .env      # ändra SESSION_SECRET, PORT, DB_FILE om du vill
npm ci --production       # snabbare än install

# 4  PM2
sudo npm i -g pm2
echo "module.exports={apps:[{name:'produktmonitor',script:'src/server.js',env:{NODE_ENV:'production',PORT:3010}}]}" > ecosystem.config.cjs
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # följer instruktionen för systemd‑hook
```

### Valfritt: Nginx + TLS
```nginx
server {
  server_name monitor.example.com;
  location / { proxy_pass http://localhost:3010; }
}
```
`sudo certbot --nginx -d monitor.example.com` ger gratis HTTPS.

---
## Databas & backup
* SQLite‑filen (default `data.db`) skapas i repo‑roten. Flytta den med `DB_FILE=/path/to/data.db` i `.env`.
* Backup: `sqlite3 data.db ".backup /backups/$(date +%F).db"` i en cron.

---
## Miljövariabler (.env)
```
SESSION_SECRET=byt‑mig
PORT=3010
#DEFAULT_WEBHOOK_URL=https://discord.com/api/webhooks/...
#DB_FILE=/var/lib/produktmonitor/data.db
```

---
## Scripts
| Kommando          | Beskrivning                 |
|-------------------|-----------------------------|
| `npm run dev`     | Start lokalt (nodemon valfritt) |

---
## Licens
MIT © <2025> <Sloxxer>
