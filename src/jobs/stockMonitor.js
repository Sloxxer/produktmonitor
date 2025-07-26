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

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Shopify: /collections/xxx/products/slug → /products/slug
    let norm = u.pathname.replace(/\/collections\/[^\/]+\/(products\/[^\/]+)/, "/$1");
    return `${u.origin}${norm}`;
  } catch {
    return url;
  }
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
      await new Promise(res => setTimeout(res, 2000));

      // Extrahera alla produktlänkar och normalisera dem!
      const products = await page.$$eval('a[href]', (anchors) => {
        // Injektera normalizeUrl i browser-koden
        function normalizeUrl(url) {
          try {
            const a = document.createElement('a');
            a.href = url;
            let norm = a.pathname.replace(/\/collections\/[^\/]+\/(products\/[^\/]+)/, "/$1");
            return a.origin + norm;
          } catch {
            return url;
          }
        }
        const seen = new Set();
        return anchors
          .map(a => {
            const isProduct =
              /\/product[s]?\//i.test(a.href); // fångar både /product/ och /products/
            if (isProduct) {
              const normalized = normalizeUrl(a.href);
              if (!seen.has(normalized)) {
                seen.add(normalized);
                return {
                  url: normalized,
                  // status: kan läggas till här senare!
                };
              }
            }
            return null;
          })
          .filter(Boolean);
      });

      await browser.close();

      // Hämta redan sparade produkter för denna kategori
      const existingRows = await db.all(
        "SELECT * FROM category_products WHERE category_id = ?",
        [c.id]
      );
      const existingUrls = new Set(existingRows.map(row => row.url));
      const foundUrls = new Set(products.map(p => p.url));

      // Spara/uppdatera alla produkter
      for (const prod of products) {
        let status = 'unknown'; // default status

        if (!existingUrls.has(prod.url)) {
          // Ny produkt
          await db.run(
            "INSERT INTO category_products (category_id, url, status, first_seen, last_seen) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
            [c.id, prod.url, status]
          );
          // Skicka webhook första gången vi hittar produkten
          if (c.webhook_url) {
            await axios.post(c.webhook_url, {
              content: `@here 🆕 Ny produkt funnen: ${prod.url}`,
            });
          }
        } else {
          // Uppdatera last_seen och ev. status
          await db.run(
            "UPDATE category_products SET last_seen = datetime('now'), status = ? WHERE category_id = ? AND url = ?",
            [status, c.id, prod.url]
          );
        }
      }

      // Markera som 'gone' de produkter som nu inte längre finns på sidan
      for (const old of existingRows) {
        if (!foundUrls.has(old.url) && old.status !== 'gone') {
          await db.run(
            "UPDATE category_products SET status = 'gone', last_seen = datetime('now') WHERE id = ?",
            old.id
          );
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
          // -- NYTT: Använd Puppeteer för fallback (JS-renderade sidor) --
          try {
            const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
            const page = await browser.newPage();
            await page.goto(p.url, { timeout: 30000, waitUntil: "networkidle2" });
            await new Promise(res => setTimeout(res, 2000));
            const html = await page.content();
            await browser.close();

            res.available = HTML_AVAILABLE_RGX.test(html);
          } catch (e) {
            console.warn("Fallback-scrape fel", p.url, e.message);
            res.available = false;
          }
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
