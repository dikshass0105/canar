import { users, subscriptions, profiles, education, projects, skills, experiences, creditPurchases } from "@shared/schema";
import type { 
  User, InsertUser, 
  Subscription, InsertSubscription,
  Profile, InsertProfile,
  Education, InsertEducation,
  Project, InsertProject,
  Skill, InsertSkill,
  Experience, InsertExperience,
  CreditPurchase, InsertCreditPurchase
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import session from "express-session";
import { randomBytes } from "crypto";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Subscription methods
  getUserSubscription(userId: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscriptionCredits(userId: string, creditsToDeduct: number): Promise<Subscription | null>;
  upgradeSubscription(subscriptionId: string, planType: string, credits: number): Promise<Subscription>;
  
  // Profile methods
  getUserProfile(userId: string): Promise<Profile | undefined>;
  createOrUpdateProfile(profile: InsertProfile): Promise<Profile>;
  getProfileByShareSlug(shareSlug: string): Promise<Profile | undefined>;
  
  // Education methods
  getUserEducation(userId: string): Promise<Education[]>;
  createEducation(education: InsertEducation): Promise<Education>;
  updateEducation(id: string, userId: string, education: Partial<InsertEducation>): Promise<Education | undefined>;
  deleteEducation(id: string, userId: string): Promise<boolean>;
  
  // Project methods
  getUserProjects(userId: string): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, userId: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string, userId: string): Promise<boolean>;
  
  // Skill methods
  getUserSkills(userId: string): Promise<Skill[]>;
  createSkill(skill: InsertSkill): Promise<Skill>;
  updateSkill(id: string, userId: string, skill: Partial<InsertSkill>): Promise<Skill | undefined>;
  deleteSkill(id: string, userId: string): Promise<boolean>;
  
  // Experience methods
  getUserExperiences(userId: string): Promise<Experience[]>;
  createExperience(experience: InsertExperience): Promise<Experience>;
  updateExperience(id: string, userId: string, experience: Partial<InsertExperience>): Promise<Experience | undefined>;
  deleteExperience(id: string, userId: string): Promise<boolean>;
  
  // Credit purchase methods
  createCreditPurchase(purchase: InsertCreditPurchase): Promise<CreditPurchase>;
  addCreditsToSubscription(userId: string, credits: number): Promise<void>;

  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Try both email and username fields since login uses email as username
    const [userByEmail] = await db.select().from(users).where(eq(users.email, username));
    if (userByEmail) return userByEmail;
    
    const [userByUsername] = await db.select().from(users).where(eq(users.username, username));
    return userByUsername || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getUserSubscription(userId: string): Promise<Subscription | undefined> {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true)))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return subscription || undefined;
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const [newSubscription] = await db
      .insert(subscriptions)
      .values(subscription)
      .returning();
    return newSubscription;
  }

  /**
   * Atomically deducts credits. The WHERE clause guarantees the balance can never
   * go negative, even with concurrent requests (no read-then-write race).
   * Returns null when there is no active subscription or not enough credits.
   */
  async updateSubscriptionCredits(userId: string, creditsToDeduct: number): Promise<Subscription | null> {
    const current = await this.getUserSubscription(userId);
    if (!current) return null;
    const [updated] = await db
      .update(subscriptions)
      .set({ creditsRemaining: sql`${subscriptions.creditsRemaining} - ${creditsToDeduct}` })
      .where(and(eq(subscriptions.id, current.id), gte(subscriptions.creditsRemaining, creditsToDeduct)))
      .returning();
    return updated ?? null;
  }

  /** Moves an active subscription to a bigger plan; unused credits are kept. */
  async upgradeSubscription(subscriptionId: string, planType: string, credits: number): Promise<Subscription> {
    const [updated] = await db
      .update(subscriptions)
      .set({
        planType,
        creditsAllocated: sql`${subscriptions.creditsAllocated} + ${credits}`,
        creditsRemaining: sql`${subscriptions.creditsRemaining} + ${credits}`,
      })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    return updated;
  }

  async getUserProfile(userId: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return profile || undefined;
  }

  async createOrUpdateProfile(profile: InsertProfile): Promise<Profile> {
    const existing = await this.getUserProfile(profile.userId);
    if (existing) {
      const [updated] = await db
        .update(profiles)
        .set({ ...profile, shareSlug: existing.shareSlug, updatedAt: new Date() })
        .where(eq(profiles.userId, profile.userId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(profiles)
      .values({ ...profile, shareSlug: profile.shareSlug ?? (await this.generateShareSlug(profile.userId)) })
      .onConflictDoNothing({ target: profiles.userId })
      .returning();
    return created ?? (await this.getUserProfile(profile.userId))!;
  }

  private async generateShareSlug(userId: string): Promise<string> {
    const user = await this.getUser(userId);
    const base = (user?.username || user?.email || "user").split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
    for (let i = 0; i < 5; i++) {
      const slug = `${base}-${randomBytes(2).toString("hex")}`;
      if (!(await this.getProfileByShareSlug(slug))) return slug;
    }
    return `${base}-${randomBytes(6).toString("hex")}`;
  }

  async getProfileByShareSlug(shareSlug: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.shareSlug, shareSlug));
    return profile || undefined;
  }

  async getUserEducation(userId: string): Promise<Education[]> {
    return await db.select().from(education).where(eq(education.userId, userId));
  }

  async createEducation(edu: InsertEducation): Promise<Education> {
    const [created] = await db.insert(education).values(edu).returning();
    return created;
  }

  async updateEducation(id: string, userId: string, edu: Partial<InsertEducation>): Promise<Education | undefined> {
    const [updated] = await db
      .update(education)
      .set(edu)
      .where(and(eq(education.id, id), eq(education.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteEducation(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(education).where(and(eq(education.id, id), eq(education.userId, userId))).returning({ id: education.id });
    return rows.length > 0;
  }

  async getUserProjects(userId: string): Promise<Project[]> {
    return await db.select().from(projects).where(eq(projects.userId, userId));
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [created] = await db.insert(projects).values(project).returning();
    return created;
  }

  async updateProject(id: string, userId: string, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set(project)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).returning({ id: projects.id });
    return rows.length > 0;
  }

  async getUserSkills(userId: string): Promise<Skill[]> {
    return await db.select().from(skills).where(eq(skills.userId, userId));
  }

  async createSkill(skill: InsertSkill): Promise<Skill> {
    const [created] = await db.insert(skills).values(skill).returning();
    return created;
  }

  async updateSkill(id: string, userId: string, skill: Partial<InsertSkill>): Promise<Skill | undefined> {
    const [updated] = await db
      .update(skills)
      .set(skill)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteSkill(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(skills).where(and(eq(skills.id, id), eq(skills.userId, userId))).returning({ id: skills.id });
    return rows.length > 0;
  }

  async getUserExperiences(userId: string): Promise<Experience[]> {
    return await db.select().from(experiences).where(eq(experiences.userId, userId));
  }

  async createExperience(experience: InsertExperience): Promise<Experience> {
    const [created] = await db.insert(experiences).values(experience).returning();
    return created;
  }

  async updateExperience(id: string, userId: string, experience: Partial<InsertExperience>): Promise<Experience | undefined> {
    const [updated] = await db
      .update(experiences)
      .set(experience)
      .where(and(eq(experiences.id, id), eq(experiences.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deleteExperience(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.userId, userId))).returning({ id: experiences.id });
    return rows.length > 0;
  }

  async createCreditPurchase(purchase: InsertCreditPurchase): Promise<CreditPurchase> {
    const [created] = await db.insert(creditPurchases).values(purchase).returning();
    return created;
  }

  async addCreditsToSubscription(userId: string, credits: number): Promise<void> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) return;
    await db
      .update(subscriptions)
      .set({ creditsRemaining: sql`${subscriptions.creditsRemaining} + ${credits}` })
      .where(eq(subscriptions.id, subscription.id));
  }
}

export const storage = new DatabaseStorage();
