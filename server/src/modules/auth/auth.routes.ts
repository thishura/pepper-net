import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../lib/async-handler.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validateBody } from "../../middleware/validate.js";
import { registerSchema, loginSchema } from "./auth.schemas.js";
import { register, login, refresh, logout, me } from "./auth.controller.js";

const router = Router();

// Throttle credential endpoints to slow brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try later" } },
});

// `register` optionally runs authenticated (for SUPER_ADMIN creating users),
// but also works unauthenticated for the very first bootstrap user. We attach a
// best-effort authenticate that doesn't hard-fail when no token is present.
router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res, next) => {
    if (req.headers.authorization) return authenticate(req, res, next);
    next();
  }),
  validateBody(registerSchema),
  asyncHandler(register),
);

router.post("/login", authLimiter, validateBody(loginSchema), asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
router.post("/logout", asyncHandler(logout));
router.get("/me", authenticate, asyncHandler(me));

export default router;
