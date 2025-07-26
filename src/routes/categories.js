import express from "express";
import { dbPromise } from "../db/index.js";

const router = express.Router();

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

// List categories
router.get("/categories", ensureAuth, async (req, res) => {
  const db = await dbPromise;
  const cats = await db.all(
    "SELECT * FROM categories WHERE user_id = ?",
    req.user.id
  );
  res.render("categories", { user: req.user, cats });
});

// Add category
router.post("/categories", ensureAuth, async (req, res) => {
  const { url, webhook_url } = req.body;
  if (!url || !webhook_url) return res.redirect("/categories?err=1");
  const db = await dbPromise;
  await db.run(
    "INSERT INTO categories (user_id, url, webhook_url) VALUES (?, ?, ?)",
    [req.user.id, url, webhook_url]
  );
  res.redirect("/categories");
});

// Delete category
router.post("/categories/:id/delete", ensureAuth, async (req, res) => {
  const db = await dbPromise;
  await db.run("DELETE FROM categories WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.user.id,
  ]);
  res.redirect("/categories");
});

// Lista alla produkter i en kategori
router.get("/category-products/:categoryId", ensureAuth, async (req, res) => {
  const db = await dbPromise;
  const categoryId = req.params.categoryId;

  // Hämta kategori-info
  const cat = await db.get("SELECT * FROM categories WHERE id = ?", categoryId);
  if (!cat) return res.status(404).send("Kategori hittades inte.");

  // Hämta produkter
  const products = await db.all(
    "SELECT * FROM category_products WHERE category_id = ? ORDER BY last_seen DESC",
    categoryId
  );

  res.render("category-products", { user: req.user, cat, products });
});

export default router;