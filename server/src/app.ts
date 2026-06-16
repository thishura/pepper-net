import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { notFoundHandler, errorHandler } from "./middleware/error-handler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";

/**
 * Assembles the PepperNet Express application. Kept separate from server.ts so
 * it can be imported by tests without binding a port.
 */
export const createApp = (): Express => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Health check.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "peppernet-api", time: new Date().toISOString() });
  });

  // Phase 2: authentication & RBAC.
  app.use("/auth", authRoutes);

  // Phase 3: orders + fractional inventory deduction.
  app.use("/orders", orderRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
