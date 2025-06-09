import cron from "node-cron";
import axios from "axios";
import puppeteer from "puppeteer";

// HTML‑baserad fallback – letar "InStock" eller "PreOrder" i JSON‑LD
const HTML_AVAILABLE_RGX = /schema\.org(?:\\\/|\/)(?:InStock|PreOrder)/i;

// ── Webhallen‑hjälpare ─────────────────────────────────────────
function extractWebhallenId(url) {
  const m = url.match(/product\/(\d+)/);
  return m ? m[1] : null;
}

async function webhallenStatus(productId) {
  const apiUrl = `https://www.webhallen.com/api/product/${productId}`;
  try {
    const { data } = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const prod = data.product ?? data;
    const webStock = prod?.stock?.web ?? prod.stockWeb ?? prod.stock_web ?? 0;
    const amountLeft = prod?.price?.amountLeft ?? prod?.price?.amount_left ?? 0;

    return {
      available: webStock > 0 || amountLeft > 0,
      webStock,
      amountLeft,
    };
  } catch (e) {
    console.warn("API‑fel (Webhallen)", productId, e.message);
    return { available: false };
  }
}

// ── Kategori‑scan med Puppeteer ───────────────────────────────
async function scanCategories(db) {
  const cats = await db.all("SELECT * FROM categories");

  for (const c of cats) {
    try {
      const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();
      await page.goto(c.url, { timeout: 30000, waitUntil: "networkidle2" });
      await page.waitForTimeout(2000);

      const links = await page.$$eval('a[href*="/product/"]', anchors =>
        anchors
          .map(a => a.href.match(/\\/product\\/(\\d+)/) ? a.href : null)
          .filter(Boolean)
      );
      await browser.close();

      for (const url of links.slice(0, 50)) {
        await db.run(
          "INSERT OR IGNORE INTO products (user_id, url) VALUES (?, ?)",
          [c.user_id, url]
        );
        const row = await db.get("SELECT last_insert_rowid() AS id");
        if (row.id && c.webhook_url) {
          await axios.post(c.webhook_url, {
            content: `@here 🆕 Ny produkt funnen: ${url}`,
          });
        }
      }

      await db.run(
        "UPDATE categories SET last_scanned = datetime('now') WHERE id = ?",
        c.id
      );
    } catch (e) {
      console.warn("Kategori-scan fel", c.url, e.message);
    }
  }
}

export default function startStockMonitor(dbPromise) {
  console.log("🚀 Stock‑monitor startar …");
  console.log("🔄 cron initierad");

  // Kör var 5:e minut; byt till "*/10 * * * * *" vid test
  cron.schedule("*/5 * * * *", async () => {
    const t = new Date().toLocaleTimeString();
    const db = await dbPromise;

    // 1) Kategorier → nya produkter
    await scanCategories(db);

    // 2) Befintliga produkter → lagerstatus
    const rows = await db.all(
      "SELECT p.*, u.webhook_url FROM products p JOIN users u ON p.user_id = u.id"
    );
    console.log(`[${t}] 🔄 cron – rader: ${rows.length}`);

    for (const p of rows) {
      let res = { available: false };
      try {
        const host = new URL(p.url).hostname;

        if (host.includes("webhallen.com")) {
          const pid = extractWebhallenId(p.url);
          if (!pid) {
            console.warn("❓ Kan ej hitta produkt‑ID i", p.url);
            continue;
          }
          res = await webhallenStatus(pid);
        } else {
          const { data: html } = await axios.get(p.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; StockMonitor/1.0)",
              "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
            },
            timeout: 15000,
            validateStatus: (s) => s < 500,
          });
          res.available = HTML_AVAILABLE_RGX.test(html);
        }

        const prev = p.last_status;
        console.log(
          `[${new Date().toLocaleTimeString()}] ${res.available ? "✔" : "✖"} ${p.url}`
        );

        if (res.available && prev !== "in_stock") {
          await db.run("UPDATE products SET last_status='in_stock' WHERE id=?", p.id);
          let msg = `@here 📢 **${p.url}** är nu *tillgänglig!*`;
          if (typeof res.webStock !== "undefined") msg += `\n📦 Lager: **${res.webStock}**`;
          if (typeof res.amountLeft !== "undefined" && res.amountLeft > 0)
            msg += `\n🛒 Förhandsbokningar kvar: **${res.amountLeft}**`;
          await axios.post(p.webhook_url, { content: msg });
        } else if (!res.available && prev === "in_stock") {
          await db.run("UPDATE products SET last_status='out_of_stock' WHERE id=?", p.id);
        }
      } catch (err) {
        console.error("Stock check failed", p.url, err.message);
      }
    }
  });
}
