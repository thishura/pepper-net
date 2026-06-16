import { z } from "zod"

export const orderTypeEnum = z.enum(["TAKEAWAY", "DINE_IN", "DELIVERY"])

export const orderStatusEnum = z.enum([
  "DRAFT",
  "CONFIRMED",
  "IN_KITCHEN",
  "READY",
  "COMPLETED",
  "CANCELLED",
])

export const createOrderBody = z.object({
  outletId: z.string().min(1),
  type: orderTypeEnum.default("TAKEAWAY"),
  customerId: z.string().optional(),
  notes: z.string().max(500).optional(),
  discountAmount: z.number().nonnegative().default(0),
  // When true, the order is created and immediately confirmed (stock deducted)
  // in a single atomic transaction.
  confirm: z.boolean().default(false),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        notes: z.string().max(200).optional(),
      }),
    )
    .min(1, "An order must have at least one item"),
})

export const listOrdersQuery = z.object({
  outletId: z.string().min(1),
  status: orderStatusEnum.optional(),
  take: z.coerce.number().int().positive().max(100).default(50),
  skip: z.coerce.number().int().nonnegative().default(0),
})

// Target status for an explicit transition (confirm/cancel/advance).
export const transitionBody = z.object({
  to: orderStatusEnum.exclude(["DRAFT"]),
})

export type CreateOrderInput = z.infer<typeof createOrderBody>
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>
