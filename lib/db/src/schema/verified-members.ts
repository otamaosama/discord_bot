import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const verifiedMembersTable = pgTable("verified_members", {
  discordId: text("discord_id").primaryKey(),
  username: text("username").notNull(),
  guildId: text("guild_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
});

export type VerifiedMember = typeof verifiedMembersTable.$inferSelect;
