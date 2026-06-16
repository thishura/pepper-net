import { Router } from "express"
import { authenticate } from "../../middleware/authenticate.js"
import { requireOutletAccess } from "../../middleware/authorize.js"
import { validateBody } from "../../middleware/validate.js"
import { createOrderBody, transitionBody } from "./order.schemas.js"
import {
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  confirmOrderHandler,
  transitionOrderHandler,
} from "./order.controller.js"

const router = Router()

// All order routes require authentication.
router.use(authenticate)

// Create an order (and optionally confirm it). outletId in body is gated.
router.post(
  "/",
  validateBody(createOrderBody),
  requireOutletAccess({ minRole: "CASHIER" }),
  createOrderHandler,
)

// List orders for an outlet (outletId in query is gated).
router.get("/", requireOutletAccess({ minRole: "CASHIER" }), listOrdersHandler)

// Single order detail.
router.get("/:id", getOrderHandler)

// Confirm a draft order -> deducts fractional inventory atomically.
router.post("/:id/confirm", confirmOrderHandler)

// Explicit pipeline transition (IN_KITCHEN, READY, COMPLETED, CANCELLED).
router.post("/:id/transition", validateBody(transitionBody), transitionOrderHandler)

export default router
