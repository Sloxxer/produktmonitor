import express from "express";
import passport from "passport";
import bcrypt from "bcrypt";
import { dbPromise } from "../db/index.js";

const router = express.Router();

router.get("/register", (req, res) => res.render("register"));

router.post("/register", async (req, res) => {
  const { username, password, webhook } = req.body;
  if (!username || !password || !webhook) return res.redirect("/register?err=missing");
  const db = await dbPromise;
  const hash = await bcrypt.hash(password, 10);
  try {
    await db.run(
      "INSERT INTO users (username, password_hash, webhook_url) VALUES (?,?,?)",
      [username, hash, webhook]
    );
    res.redirect("/login");
  } catch {
    res.redirect("/register?err=exists");
  }
});

router.get("/login", (req, res) => res.render("login"));
router.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login?err=1",
  })
);

router.post("/logout", (req, res) => {
  req.logout(() => res.redirect("/login"));
});

export default router;