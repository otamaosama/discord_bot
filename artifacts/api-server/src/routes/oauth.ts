import { Router } from "express";
import { db, verifiedMembersTable } from "@workspace/db";
import { getRedirectUri } from "../lib/discord-config.js";
import { ensureVerifiedRole } from "../lib/discord-roles.js";

const router = Router();

router.get("/oauth/callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  const guildId = req.query["state"] as string | undefined;

  if (!code) {
    res.status(400).send(errorPage("No authorization code received."));
    return;
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env["DISCORD_CLIENT_ID"]!,
        client_secret: process.env["DISCORD_CLIENT_SECRET"]!,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      req.log.error({ err }, "Discord token exchange failed");
      res.status(500).send(errorPage("Failed to exchange token with Discord."));
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      res.status(500).send(errorPage("Failed to fetch your Discord profile."));
      return;
    }

    const user = (await userRes.json()) as {
      id: string;
      username: string;
      global_name?: string;
    };
    const displayName = user.global_name ?? user.username;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await db
      .insert(verifiedMembersTable)
      .values({
        discordId: user.id,
        username: displayName,
        guildId: guildId ?? null,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: verifiedMembersTable.discordId,
        set: {
          username: displayName,
          guildId: guildId ?? null,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          verifiedAt: new Date(),
        },
      });

    req.log.info({ discordId: user.id, username: user.username, guildId }, "Member verified");

    // Assign the Verified role — runs after DB save so the member is always persisted
    // even if role assignment fails (bot missing permissions, etc.)
    if (guildId) {
      void ensureVerifiedRole(guildId, user.id);
    }

    res.send(successPage(displayName));
  } catch (err) {
    req.log.error({ err }, "OAuth callback error");
    res.status(500).send(errorPage("An unexpected error occurred."));
  }
});

function successPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verified!</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #1e2130;
      border: 1px solid #2d3148;
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 700; color: #57F287; margin-bottom: 10px; }
    p { color: #a0a8c0; font-size: 15px; line-height: 1.5; }
    .name { color: #fff; font-weight: 600; }
    .badge {
      display: inline-block;
      margin-top: 16px;
      padding: 4px 14px;
      background: rgba(87,242,135,0.15);
      border: 1px solid rgba(87,242,135,0.3);
      border-radius: 99px;
      color: #57F287;
      font-size: 13px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>You're verified!</h1>
    <p>Hey <span class="name">${username}</span>, your account has been saved.<br>
    If this server ever gets nuked, you can be re-added automatically.</p>
    <div class="badge">✦ Verified role assigned</div>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #1e2130;
      border: 1px solid #3d2030;
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 700; color: #ED4245; margin-bottom: 10px; }
    p { color: #a0a8c0; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Something went wrong</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
