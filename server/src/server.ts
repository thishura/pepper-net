import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[PepperNet] API listening on http://localhost:${env.PORT}`);
});

// Graceful shutdown: drain HTTP, then disconnect Prisma.
const shutdown = async (signal: string) => {
  console.log(`[PepperNet] ${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
