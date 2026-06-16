import { Prisma, OrderStatus, OrderType } from "@prisma/client"
import { prisma } from "../../lib/prisma.js"
import { AppError } from "../../lib/errors.js"
import {
  computeIngredientDemand,
  deductStockForOrder,
  restockForCancelledOrder,
} from "./inventory.service.js"
import type { CreateOrderInput } from "./order.schemas.js"

type Tx = Prisma.TransactionClient

// Allowed forward transitions of the order pipeline.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_KITCHEN", "CANCELLED"],
  IN_KITCHEN: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
}

// Statuses at/after which inventory has been deducted from stock.
const DEDUCTED_STATUSES: OrderStatus[] = ["CONFIRMED", "IN_KITCHEN", "READY", "COMPLETED"]

const orderInclude = {
  items: true,
  payments: true,
  customer: true,
  outlet: { select: { id: true, code: true, name: true, currency: true } },
} satisfies Prisma.OrderInclude

/**
 * Generate the next per-outlet sequential order number, e.g. "COL01-000123".
 * Relies on the unique [outletId, orderNumber] constraint to catch races; the
 * caller retries on collision.
 */
async function nextOrderNumber(tx: Tx, outletId: string, outletCode: string): Promise<string> {
  const last = await tx.order.findFirst({
    where: { outletId },
    orderBy: { createdAt: "desc" },
    select: { orderNumber: true },
  })
  let seq = 1
  if (last) {
    const suffix = last.orderNumber.split("-").pop() ?? "0"
    seq = Number.parseInt(suffix, 10) + 1
  }
  return `${outletCode}-${String(seq).padStart(6, "0")}`
}

export async function createOrder(input: CreateOrderInput, userId: string) {
  const outlet = await prisma.outlet.findUnique({ where: { id: input.outletId } })
  if (!outlet) throw new AppError(404, "OUTLET_NOT_FOUND", "Outlet not found")
  if (!outlet.isActive) throw new AppError(422, "OUTLET_INACTIVE", "Outlet is not active")

  // Load and validate menu items (must belong to this outlet & be available).
  const menuItemIds = [...new Set(input.items.map((i) => i.menuItemId))]
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, outletId: input.outletId },
  })
  const menuItemMap = new Map(menuItems.map((m) => [m.id, m]))

  for (const item of input.items) {
    const mi = menuItemMap.get(item.menuItemId)
    if (!mi) {
      throw new AppError(
        422,
        "MENU_ITEM_INVALID",
        `Menu item ${item.menuItemId} does not belong to outlet ${outlet.code}`,
      )
    }
    if (!mi.isAvailable) {
      throw new AppError(422, "MENU_ITEM_UNAVAILABLE", `"${mi.name}" is currently unavailable`)
    }
  }

  // Build line items with price snapshots and compute totals.
  const lineData = input.items.map((item) => {
    const mi = menuItemMap.get(item.menuItemId)!
    const unitPrice = mi.price
    const lineTotal = unitPrice.mul(item.quantity)
    return {
      menuItemId: mi.id,
      nameSnapshot: mi.name,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
      notes: item.notes ?? null,
    }
  })

  const subtotal = lineData.reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0))
  const discountAmount = new Prisma.Decimal(input.discountAmount)
  const taxable = subtotal.sub(discountAmount)
  const taxAmount = taxable.mul(outlet.taxRate).div(100)
  const serviceCharge = taxable.mul(outlet.serviceCharge).div(100)
  const totalAmount = taxable.add(taxAmount).add(serviceCharge)

  if (totalAmount.lessThan(0)) {
    throw new AppError(422, "DISCOUNT_TOO_LARGE", "Discount exceeds the order subtotal")
  }

  // Retry loop guards against order-number race collisions.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const orderNumber = await nextOrderNumber(tx, outlet.id, outlet.code)

        const order = await tx.order.create({
          data: {
            outletId: outlet.id,
            orderNumber,
            status: OrderStatus.DRAFT,
            type: input.type as OrderType,
            customerId: input.customerId ?? null,
            createdById: userId,
            subtotal,
            discountAmount,
            taxAmount,
            serviceCharge,
            totalAmount,
            notes: input.notes ?? null,
            items: { create: lineData },
          },
          include: orderInclude,
        })

        if (input.confirm) {
          return await confirmWithinTx(tx, order.id, userId)
        }
        return order
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue // order-number collision, retry
      }
      throw err
    }
  }

  throw new AppError(409, "ORDER_NUMBER_CONFLICT", "Could not allocate an order number, retry")
}

/**
 * Confirm a DRAFT order within an existing transaction: compute fractional
 * demand and deduct per-outlet stock atomically with the status change.
 */
async function confirmWithinTx(tx: Tx, orderId: string, userId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found")
  if (order.status !== OrderStatus.DRAFT) {
    throw new AppError(409, "INVALID_TRANSITION", `Cannot confirm an order in ${order.status}`)
  }

  const demand = await computeIngredientDemand(
    tx,
    order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
  )
  await deductStockForOrder(tx, {
    outletId: order.outletId,
    orderId: order.id,
    demand,
    createdById: userId,
  })

  return tx.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.CONFIRMED, confirmedAt: new Date() },
    include: orderInclude,
  })
}

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "confirmedAt",
  IN_KITCHEN: "inKitchenAt",
  READY: "readyAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
}

/**
 * Transition an order to a new status, enforcing the pipeline state machine
 * and triggering inventory side-effects (deduct on CONFIRMED, restock on
 * CANCELLED of an already-deducted order).
 */
export async function transitionOrder(orderId: string, to: OrderStatus, userId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found")

    const allowed = TRANSITIONS[order.status]
    if (!allowed.includes(to)) {
      throw new AppError(
        409,
        "INVALID_TRANSITION",
        `Cannot move order from ${order.status} to ${to}`,
      )
    }

    // Inventory deduction happens on the DRAFT -> CONFIRMED edge.
    if (to === OrderStatus.CONFIRMED) {
      return confirmWithinTx(tx, orderId, userId)
    }

    // Restock if cancelling an order whose stock was already deducted.
    if (to === OrderStatus.CANCELLED && DEDUCTED_STATUSES.includes(order.status)) {
      await restockForCancelledOrder(tx, {
        outletId: order.outletId,
        orderId: order.id,
        createdById: userId,
      })
    }

    const tsField = STATUS_TIMESTAMP[to]
    return tx.order.update({
      where: { id: order.id },
      data: { status: to, ...(tsField ? { [tsField]: new Date() } : {}) },
      include: orderInclude,
    })
  })
}

export async function getOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude })
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found")
  return order
}

export async function listOrders(params: {
  outletId: string
  status?: OrderStatus
  take: number
  skip: number
}) {
  const where: Prisma.OrderWhereInput = {
    outletId: params.outletId,
    ...(params.status ? { status: params.status } : {}),
  }
  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: params.take,
      skip: params.skip,
    }),
    prisma.order.count({ where }),
  ])
  return { data, total, take: params.take, skip: params.skip }
}
