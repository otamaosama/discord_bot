export function getRedirectUri(): string {
  // Check for an explicit override first (set this in Railway/any host dashboard)
  const override = process.env["REDIRECT_URI"];
  if (override) return override;

  // Railway auto-provides this
  const railway = process.env["RAILWAY_PUBLIC_DOMAIN"];
  if (railway) return `https://${railway}/api/oauth/callback`;

  // Replit dev / prod
  const replitDev = process.env["REPLIT_DEV_DOMAIN"];
  if (replitDev) return `https://${replitDev}/api/oauth/callback`;

  const replitProd = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (replitProd) return `https://${replitProd}/api/oauth/callback`;

  throw new Error(
    "Cannot determine public domain. Set REDIRECT_URI, RAILWAY_PUBLIC_DOMAIN, or REPLIT_DEV_DOMAIN.",
  );
}

export function getOAuthUrl(guildId: string): string {
  const params = new URLSearchParams({
    client_id: process.env["DISCORD_CLIENT_ID"]!,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "identify guilds.join",
    state: guildId,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
