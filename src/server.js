/*──────────────────────────── src/server.js */
import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { initSchema, dbPromise } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import startStockMonitor from "./jobs/stockMonitor.js";
import bcrypt from "bcrypt";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//──────────────── Passport Local strategy
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const db = await dbPromise;
      const user = await db.get("SELECT * FROM users WHERE username = ?", username);
      if (!user) return done(null, false, { message: "Fel användare" });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return done(null, false, { message: "Fel lösenord" });
      return done(null, user);
    } catch (err) {
      done(err);
    }
  })
);
passport.serializeUser((u, cb) => cb(null, u.id));
passport.deserializeUser(async (id, cb) => {
  const db = await dbPromise;
  cb(null, await db.get("SELECT * FROM users WHERE id = ?", id));
});

//──────────────── Express setup
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

//──────────────── Routes
app.use(authRoutes);
app.use(productRoutes);
app.use(categoriesRoutes);

//──────────────── Boot
await initSchema();
startStockMonitor(dbPromise);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));