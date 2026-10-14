import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { z } from "zod";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(255),
  username: z.string().trim().max(100).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/** Never send the password hash to the browser. */
export function publicUser(user: SelectUser) {
  const { password: _password, ...safe } = user;
  return safe;
}

export function setupAuth(app: Express) {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  if (isProd) app.set("trust proxy", 1);

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-only-secret",
      resave: false,
      saveUninitialized: false,
      store: storage.sessionStore,
      name: "connect.sid",
      cookie: {
        secure: isProd,
        httpOnly: true, // not readable from JS -> protects the session from XSS
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username.trim().toLowerCase());
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      done(null, (await storage.getUser(id)) ?? false);
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { email, username, password } = parsed.data;
      if (await storage.getUserByEmail(email)) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      const user = await storage.createUser({
        email,
        username: username || email.split("@")[0],
        password: await hashPassword(password),
      });
      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(publicUser(user));
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: unknown, user: SelectUser | false) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json(publicUser(user));
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.sendStatus(200);
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(publicUser(req.user!));
  });
}
