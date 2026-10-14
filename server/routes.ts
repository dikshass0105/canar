import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import {
  insertEducationSchema,
  insertProjectSchema,
  insertSkillSchema,
  insertExperienceSchema,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Business constants (single source of truth - the client never decides prices)
// ---------------------------------------------------------------------------
const CREDITS_PER_EDIT = 5;

const PLANS = [
  {
    id: "basic",
    name: "Basic",
    price: 199900, // paise (₹1,999)
    credits: 500,
    features: ["500 editing credits", "PDF export unlimited", "Public profile sharing", "Photo & CV upload"],
  },
  {
    id: "premium",
    name: "Premium",
    price: 299900, // paise (₹2,999)
    credits: 1000,
    features: ["1,000 editing credits", "PDF export unlimited", "Public profile sharing", "Photo & CV upload", "Priority support"],
  },
] as const;

const TOPUP = { credits: 100, price: 50000 }; // ₹500 for 100 credits

// ---------------------------------------------------------------------------
// Middleware & helpers
// ---------------------------------------------------------------------------
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Please sign in to continue" });
  }
  next();
}

/**
 * Atomically charges credits for an edit. Responds with the proper error and
 * returns false if the user may not edit; the caller must then stop.
 */
async function chargeForEdit(req: Request, res: Response): Promise<boolean> {
  const userId = req.user!.id;
  const charged = await storage.updateSubscriptionCredits(userId, CREDITS_PER_EDIT);
  if (charged) return true;

  const subscription = await storage.getUserSubscription(userId);
  if (!subscription) {
    res.status(403).json({ code: "NO_SUBSCRIPTION", message: "An active subscription is required to edit your profile." });
  } else {
    res.status(403).json({ code: "INSUFFICIENT_CREDITS", message: "Insufficient credits. Please top-up or subscribe." });
  }
  return false;
}

const refundEdit = (userId: string) => storage.addCreditsToSubscription(userId, CREDITS_PER_EDIT);

/** Wraps an async handler so thrown errors reach the central error middleware. */
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const profileSchema = z
  .object({
    name: z.string().trim().max(255).nullish(),
    email: z.string().trim().email("Enter a valid email").max(255).or(z.literal("")).nullish(),
    bio: z.string().max(5000).nullish(),
  })
  .strict();

// ---------------------------------------------------------------------------
// File uploads (no extra dependency: the client sends the raw file as the body)
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

type UploadKind = { mimes: Record<string, string>; maxBytes: number; signatures: Record<string, number[][]> };

const UPLOAD_KINDS: Record<"photo" | "cv", UploadKind> = {
  photo: {
    maxBytes: 5 * 1024 * 1024,
    mimes: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
    signatures: { "image/jpeg": [[0xff, 0xd8, 0xff]], "image/png": [[0x89, 0x50, 0x4e, 0x47]], "image/webp": [[0x52, 0x49, 0x46, 0x46]] },
  },
  cv: {
    maxBytes: 10 * 1024 * 1024,
    mimes: {
      "application/pdf": ".pdf",
      "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    },
    signatures: {
      "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
      "application/msword": [[0xd0, 0xcf, 0x11, 0xe0]],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]],
    },
  },
};

const hasSignature = (buf: Buffer, sigs: number[][]) => sigs.some((sig) => sig.every((b, i) => buf[i] === b));

async function removeOldUpload(url: string | null | undefined) {
  if (!url || !url.startsWith("/uploads/")) return;
  // basename() prevents path traversal
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
}

function registerUploadRoute(app: Express, kind: "photo" | "cv") {
  const cfg = UPLOAD_KINDS[kind];
  app.patch(
    `/api/profile/${kind}`,
    requireAuth,
    express.raw({ type: () => true, limit: cfg.maxBytes }),
    wrap(async (req, res) => {
      const mime = (req.headers["content-type"] || "").split(";")[0].trim();
      const ext = cfg.mimes[mime];
      const body = req.body as Buffer;
      if (!ext || !Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ message: `Unsupported file type. Allowed: ${Object.values(cfg.mimes).join(", ")}` });
      }
      if (!hasSignature(body, cfg.signatures[mime])) {
        return res.status(400).json({ message: "File content does not match its type" });
      }
      if (!(await chargeForEdit(req, res))) return;

      const userId = req.user!.id;
      try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        const fileName = `${userId}-${kind}-${randomBytes(6).toString("hex")}${ext}`;
        await fs.writeFile(path.join(UPLOAD_DIR, fileName), body);

        const existing = await storage.getUserProfile(userId);
        const url = `/uploads/${fileName}`;
        const profile = await storage.createOrUpdateProfile({
          ...(existing ?? {}),
          userId,
          ...(kind === "photo" ? { photoUrl: url } : { cvUrl: url }),
        } as any);
        await removeOldUpload(kind === "photo" ? existing?.photoUrl : existing?.cvUrl);
        res.json(profile);
      } catch (err) {
        await refundEdit(userId);
        throw err;
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Generic CRUD for the four profile sections (education, projects, ...)
// ---------------------------------------------------------------------------
function registerSection(
  app: Express,
  route: string,
  schema: z.ZodObject<any>,
  ops: {
    list: (userId: string) => Promise<unknown[]>;
    create: (data: any) => Promise<unknown>;
    update: (id: string, userId: string, data: any) => Promise<unknown | undefined>;
    remove: (id: string, userId: string) => Promise<boolean>;
  },
) {
  const createSchema = schema.omit({ userId: true });
  const updateSchema = createSchema.partial();
  const idParam = z.string().uuid();

  app.get(`/api/${route}`, requireAuth, wrap(async (req, res) => res.json(await ops.list(req.user!.id))));

  app.post(
    `/api/${route}`,
    requireAuth,
    wrap(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      if (!(await chargeForEdit(req, res))) return;
      try {
        res.status(201).json(await ops.create({ ...parsed.data, userId: req.user!.id }));
      } catch (err) {
        await refundEdit(req.user!.id);
        throw err;
      }
    }),
  );

  app.put(
    `/api/${route}/:id`,
    requireAuth,
    wrap(async (req, res) => {
      if (!idParam.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid id" });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      if (!(await chargeForEdit(req, res))) return;
      try {
        const updated = await ops.update(req.params.id, req.user!.id, parsed.data);
        if (!updated) {
          await refundEdit(req.user!.id); // nothing changed (not found / not yours) -> no charge
          return res.status(404).json({ message: "Not found" });
        }
        res.json(updated);
      } catch (err) {
        await refundEdit(req.user!.id);
        throw err;
      }
    }),
  );

  // Deleting is free and only affects rows owned by the signed-in user.
  app.delete(
    `/api/${route}/:id`,
    requireAuth,
    wrap(async (req, res) => {
      if (!idParam.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid id" });
      const removed = await ops.remove(req.params.id, req.user!.id);
      if (!removed) return res.status(404).json({ message: "Not found" });
      res.sendStatus(204);
    }),
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", index: false, dotfiles: "deny" }));

  // ---- Subscription ------------------------------------------------------
  app.get("/api/subscription/plans", (_req, res) => res.json(PLANS));

  app.post(
    "/api/subscription/subscribe",
    requireAuth,
    wrap(async (req, res) => {
      const parsed = z.object({ planType: z.enum(["Basic", "Premium"]) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid plan type" });

      const userId = req.user!.id;
      const plan = PLANS.find((p) => p.name === parsed.data.planType)!;
      const current = await storage.getUserSubscription(userId);

      // NOTE: payment gateway (Stripe/Razorpay) would confirm payment here before
      // granting credits. It is mocked for this assessment.
      if (current) {
        // Only Basic -> Premium is a valid upgrade; anything else is a duplicate purchase.
        if (current.planType === "Premium" || plan.name === "Basic") {
          return res.status(409).json({ message: `You already have the ${current.planType} plan. Buy a credit top-up for more credits.` });
        }
        return res.json(await storage.upgradeSubscription(current.id, plan.name, plan.credits));
      }

      const subscription = await storage.createSubscription({
        userId,
        planType: plan.name,
        creditsAllocated: plan.credits,
        creditsRemaining: plan.credits,
        active: true,
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      res.status(201).json(subscription);
    }),
  );

  app.post(
    "/api/subscription/credits/topup",
    requireAuth,
    wrap(async (req, res) => {
      const userId = req.user!.id;
      if (!(await storage.getUserSubscription(userId))) {
        return res.status(403).json({ message: "Active subscription required for credit top-up" });
      }
      // Package is fixed on the server - the client cannot choose credits/price.
      const packages = z.coerce.number().int().min(1).max(10).safeParse(req.body?.quantity ?? 1);
      if (!packages.success) return res.status(400).json({ message: "Invalid quantity" });

      const credits = TOPUP.credits * packages.data;
      await storage.createCreditPurchase({ userId, credits, amount: TOPUP.price * packages.data });
      await storage.addCreditsToSubscription(userId, credits);
      res.json({ message: "Credits added successfully", credits });
    }),
  );

  // ---- Credits -----------------------------------------------------------
  app.get(
    "/api/credits",
    requireAuth,
    wrap(async (req, res) => {
      const subscription = await storage.getUserSubscription(req.user!.id);
      if (!subscription) return res.json({ creditsRemaining: 0, hasSubscription: false, planType: null });
      res.json({
        creditsRemaining: subscription.creditsRemaining,
        hasSubscription: true,
        planType: subscription.planType,
      });
    }),
  );

  // ---- Profile -----------------------------------------------------------
  app.get(
    "/api/profile",
    requireAuth,
    wrap(async (req, res) => {
      const userId = req.user!.id;
      const [profile, education, projects, skills, experiences] = await Promise.all([
        storage.getUserProfile(userId),
        storage.getUserEducation(userId),
        storage.getUserProjects(userId),
        storage.getUserSkills(userId),
        storage.getUserExperiences(userId),
      ]);
      // Always return the full shape so the client never crashes on a new user.
      res.json({ ...(profile ?? {}), education, projects, skills, experiences });
    }),
  );

  app.put(
    "/api/profile",
    requireAuth,
    wrap(async (req, res) => {
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid profile data", errors: parsed.error.errors });
      if (!(await chargeForEdit(req, res))) return;

      const userId = req.user!.id;
      try {
        // Merge with the existing row so a single-field autosave never wipes other fields.
        const existing = await storage.getUserProfile(userId);
        const profile = await storage.createOrUpdateProfile({ ...(existing ?? {}), ...parsed.data, userId } as any);
        res.json(profile);
      } catch (err) {
        await refundEdit(userId);
        throw err;
      }
    }),
  );

  registerUploadRoute(app, "photo");
  registerUploadRoute(app, "cv");

  // ---- Sections ----------------------------------------------------------
  registerSection(app, "education", insertEducationSchema, {
    list: storage.getUserEducation.bind(storage),
    create: storage.createEducation.bind(storage),
    update: storage.updateEducation.bind(storage),
    remove: storage.deleteEducation.bind(storage),
  });
  registerSection(app, "projects", insertProjectSchema, {
    list: storage.getUserProjects.bind(storage),
    create: storage.createProject.bind(storage),
    update: storage.updateProject.bind(storage),
    remove: storage.deleteProject.bind(storage),
  });
  registerSection(app, "skills", insertSkillSchema, {
    list: storage.getUserSkills.bind(storage),
    create: storage.createSkill.bind(storage),
    update: storage.updateSkill.bind(storage),
    remove: storage.deleteSkill.bind(storage),
  });
  registerSection(app, "experiences", insertExperienceSchema, {
    list: storage.getUserExperiences.bind(storage),
    create: storage.createExperience.bind(storage),
    update: storage.updateExperience.bind(storage),
    remove: storage.deleteExperience.bind(storage),
  });

  // ---- Public profile (no auth, no internal ids) ----------------------------
  app.get(
    "/api/profile/share/:shareSlug",
    wrap(async (req, res) => {
      const profile = await storage.getProfileByShareSlug(req.params.shareSlug);
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      const [education, projects, skills, experiences] = await Promise.all([
        storage.getUserEducation(profile.userId),
        storage.getUserProjects(profile.userId),
        storage.getUserSkills(profile.userId),
        storage.getUserExperiences(profile.userId),
      ]);
      const { userId: _userId, id: _id, ...publicProfile } = profile;
      const strip = <T extends { userId: string }>(rows: T[]) => rows.map(({ userId: _u, ...rest }) => rest);
      res.json({
        ...publicProfile,
        education: strip(education),
        projects: strip(projects),
        skills: strip(skills),
        experiences: strip(experiences),
      });
    }),
  );

  return createServer(app);
}
