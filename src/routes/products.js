import express from "express";
import { dbPromise } from "../db/index.js";

const router = express.Router();

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect("/login");
}

// Dashboard
router.get("/", ensureAuth, async (req, res) => {
  const db = await dbPromise;
  const products = await db.all("SELECT * FROM products WHERE user_id = ?", req.user.id);
  res.render("dashboard", { user: req.user, products });
});

router.post("/products", ensureAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.redirect("/?err=missing");
  const db = await dbPromise;
  await db.run("INSERT INTO products (user_id, url) VALUES (?,?)", [req.user.id, url]);
  res.redirect("/");
});

router.post("/products/:id/delete", ensureAuth, async (req, res) => {
  const db = await dbPromise;
  await db.run("DELETE FROM products WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.redirect("/");
});

// ── Webhook settings ─────────────────────────────
router.get("/settings", ensureAuth, (req, res) => {
  res.render("settings", { user: req.user });
});

router.post("/settings", ensureAuth, async (req, res) => {
  const { webhook } = req.body;
  if (!webhook) return res.redirect("/settings?err=missing");
  const db = await dbPromise;
  await db.run("UPDATE users SET webhook_url = ? WHERE id = ?", [webhook, req.user.id]);
  // uppdatera session kopian
  req.user.webhook_url = webhook;
  res.redirect("/settings?ok=1");
});

export default router;