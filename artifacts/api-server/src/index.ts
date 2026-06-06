import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startBot, registerCommands } from "./bot.js";
import { pool } from "@workspace/db";
import type { Client } from "discord.js";
import type { Server } from "node:http";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let discordClient: Client | null = null;
let httpServer: Server | null = null;

httpServer = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

if (!process.env["DISCORD_BOT_TOKEN"]) {
  logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
} else {
  registerCommands()
    .then(() => {
      discordClient = startBot();
    })
    .catch((err) => {
      logger.error({ err }, "Failed to start Discord bot");
    });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received — draining connections");

  httpServer?.close((err) => {
    if (err) logger.error({ err }, "Error closing HTTP server");
  });

  if (discordClient) {
    try {
      discordClient.destroy();
      logger.info("Discord client destroyed");
    } catch (err) {
      logger.error({ err }, "Error destroying Discord client");
    }
  }

  try {
    await pool.end();
    logger.info("Database pool closed — all data saved");
  } catch (err) {
    logger.error({ err }, "Error closing database pool");
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection — shutting down");
  void shutdown("unhandledRejection");
});
