import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { db, verifiedMembersTable } from "@workspace/db";
import { eq, lt, asc } from "drizzle-orm";
import { getOAuthUrl, getRedirectUri } from "./lib/discord-config.js";
import { logger } from "./lib/logger.js";

const BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"]!;
const CLIENT_ID = process.env["DISCORD_CLIENT_ID"]!;
const CLIENT_SECRET = process.env["DISCORD_CLIENT_SECRET"]!;

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  try {
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
  } catch {
    return null;
  }
}

async function handleVerify(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
    return;
  }

  const oauthUrl = getOAuthUrl(guildId);

  const embed = new EmbedBuilder()
    .setTitle("🛡️ Server Backup Verification")
    .setDescription(
      "Click the button below to verify your account.\n\n" +
      "**Why?** If this server ever gets nuked or deleted, verified members can be automatically re-added to a new server.\n\n" +
      "This only grants permission to add you to Discord servers — nothing else."
    )
    .setColor(0x5865f2)
    .setFooter({ text: "Your token is stored securely and only used for server recovery." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Verify My Account")
      .setStyle(ButtonStyle.Link)
      .setURL(oauthUrl)
      .setEmoji("✅")
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleJoin(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "You need Administrator permission to use this command.", ephemeral: true });
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const inviteLink = interaction.options.getString("invitelink", true);

  await interaction.deferReply({ ephemeral: true });

  const inviteCodeMatch = inviteLink.match(/discord(?:\.gg|(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/);
  if (!inviteCodeMatch) {
    await interaction.editReply("Invalid invite link. Please use a Discord invite link like `https://discord.gg/abc123`.");
    return;
  }
  const inviteCode = inviteCodeMatch[1];

  const inviteRes = await fetch(`https://discord.com/api/v10/invites/${inviteCode}?with_counts=true`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });

  if (!inviteRes.ok) {
    await interaction.editReply("Could not resolve that invite link. Make sure it's valid and hasn't expired.");
    return;
  }

  const inviteData = (await inviteRes.json()) as { guild: { id: string; name: string } };
  const targetGuildId = inviteData.guild.id;
  const targetGuildName = inviteData.guild.name;

  const members = await db
    .select()
    .from(verifiedMembersTable)
    .orderBy(asc(verifiedMembersTable.verifiedAt))
    .limit(amount);

  if (members.length === 0) {
    await interaction.editReply("No verified members found in the database yet. Have members use `/verify` first.");
    return;
  }

  let added = 0;
  let alreadyIn = 0;
  let failed = 0;

  for (const member of members) {
    let accessToken = member.accessToken;

    if (new Date() >= member.expiresAt) {
      const refreshed = await refreshAccessToken(member.refreshToken);
      if (refreshed) {
        accessToken = refreshed.access_token;
        const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
        await db
          .update(verifiedMembersTable)
          .set({
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: newExpiresAt,
          })
          .where(eq(verifiedMembersTable.discordId, member.discordId));
      } else {
        failed++;
        continue;
      }
    }

    try {
      const addRes = await fetch(
        `https://discord.com/api/v10/guilds/${targetGuildId}/members/${member.discordId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: accessToken }),
        }
      );

      if (addRes.status === 201) {
        added++;
      } else if (addRes.status === 204) {
        alreadyIn++;
      } else {
        failed++;
        logger.warn({ status: addRes.status, discordId: member.discordId }, "Failed to add member");
      }
    } catch (err) {
      failed++;
      logger.error({ err, discordId: member.discordId }, "Error adding member");
    }
  }

  const lines = [
    `**Results for \`${targetGuildName}\`:**`,
    `✅ Added: **${added}**`,
    `👥 Already in server: **${alreadyIn}**`,
    `❌ Failed: **${failed}**`,
    `📋 Total processed: **${members.length}**`,
  ];

  await interaction.editReply(lines.join("\n"));
}

export async function registerCommands(): Promise<void> {
  const commands = [
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Get a verification link — saves your account so you can be re-added if the server gets nuked"),
    new SlashCommandBuilder()
      .setName("join")
      .setDescription("Re-add verified members to a server (Admin only)")
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("How many members to add (max 500)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(500)
      )
      .addStringOption((opt) =>
        opt
          .setName("invitelink")
          .setDescription("Discord invite link for the target server")
          .setRequired(true)
      ),
  ];

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map((c) => c.toJSON()),
  });
  logger.info("Slash commands registered globally");
}

export function startBot(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("clientReady", (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
  });

  client.on("shardError", (err) => {
    logger.error({ err }, "Discord shard error — will auto-reconnect");
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === "verify") {
        await handleVerify(interaction);
      } else if (interaction.commandName === "join") {
        await handleJoin(interaction);
      }
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, "Command handler error");
      const reply = { content: "An error occurred running that command.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(reply.content);
      } else {
        await interaction.reply(reply);
      }
    }
  });

  client.login(BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login Discord bot");
  });

  return client;
}
