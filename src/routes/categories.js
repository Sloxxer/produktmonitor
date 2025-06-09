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
  const { url } = req.body;
  if (!url) return res.redirect("/categories?err=1");
  const db = await dbPromise;
  await db.run("INSERT INTO categories (user_id, url) VALUES (?, ?)", [
    req.user.id,
    url,
  ]);
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

export default router;