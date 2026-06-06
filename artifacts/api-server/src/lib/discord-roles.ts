import { logger } from "./logger.js";

const VERIFIED_ROLE_NAME = "Verified";
const VERIFIED_ROLE_COLOR = 0x57f287; // Discord green

const BOT_TOKEN = () => process.env["DISCORD_BOT_TOKEN"]!;

interface DiscordRole {
  id: string;
  name: string;
}

async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${BOT_TOKEN()}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch roles: ${res.status}`);
  return res.json() as Promise<DiscordRole[]>;
}

async function createVerifiedRole(guildId: string): Promise<DiscordRole> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${BOT_TOKEN()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: VERIFIED_ROLE_NAME,
      color: VERIFIED_ROLE_COLOR,
      mentionable: false,
      hoist: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Verified role: ${res.status} ${err}`);
  }
  return res.json() as Promise<DiscordRole>;
}

async function assignRole(guildId: string, userId: string, roleId: string): Promise<void> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${BOT_TOKEN()}` },
    },
  );
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`Failed to assign role: ${res.status} ${err}`);
  }
}

/**
 * Ensures the "Verified" role exists in the guild (creates it if not),
 * then assigns it to the user. Errors are logged but never thrown — the
 * member is already saved to the DB by the time this runs.
 */
export async function ensureVerifiedRole(guildId: string, userId: string): Promise<void> {
  try {
    const roles = await getGuildRoles(guildId);
    let role = roles.find((r) => r.name === VERIFIED_ROLE_NAME);

    if (!role) {
      logger.info({ guildId }, `"${VERIFIED_ROLE_NAME}" role not found — creating it`);
      role = await createVerifiedRole(guildId);
      logger.info({ guildId, roleId: role.id }, `"${VERIFIED_ROLE_NAME}" role created`);
    }

    await assignRole(guildId, userId, role.id);
    logger.info({ guildId, userId, roleId: role.id }, `Assigned "${VERIFIED_ROLE_NAME}" role`);
  } catch (err) {
    logger.warn({ err, guildId, userId }, `Could not assign "${VERIFIED_ROLE_NAME}" role — member still saved`);
  }
}
