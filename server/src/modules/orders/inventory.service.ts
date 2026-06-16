import { Prisma, StockMovementType, UnitOfMeasure } from "@prisma/client"
import { convertQuantity, isConvertible } from "../../lib/units.js"
import { AppError } from "../../lib/errors.js"

// A Prisma transaction client (the `tx` passed to prisma.$transaction).
type Tx = Prisma.TransactionClient

export interface RequiredIngredient {
  ingredientId: string
  ingredientName: string
  // Quantity required, aggregated across all order lines, expressed in the
  // ingredient's base unit.
  requiredQty: Prisma.Decimal
  baseUnit: UnitOfMeasure
}

/**
 * Compute the total fractional ingredient demand for a set of order lines.
 *
 * For each line we load the menu item's recipe and multiply each recipe
 * component's quantity by the ordered quantity, converting into the
 * ingredient's base unit, then aggregate per ingredient across the whole order.
 *
 * Example: 2 x "Normal Chicken Fried Rice"
 *   recipe = 200g rice + 100g chicken + 1 egg
 *   => 400g rice, 200g chicken, 2 eggs
 */
export async function computeIngredientDemand(
  tx: Tx,
  lines: { menuItemId: string; quantity: number }[],
): Promise<Map<string, RequiredIngredient>> {
  const menuItemIds = [...new Set(lines.map((l) => l.menuItemId))]

  const menuItems = await tx.menuItem.findMany({
    where: { id: { in: menuItemIds } },
    include: {
      recipeItems: { include: { ingredient: true } },
    },
  })
  const menuItemMap = new Map(menuItems.map((m) => [m.id, m]))

  const demand = new Map<string, RequiredIngredient>()

  for (const line of lines) {
    const menuItem = menuItemMap.get(line.menuItemId)
    if (!menuItem) {
      throw new AppError(404, "MENU_ITEM_NOT_FOUND", `Menu item ${line.menuItemId} not found`)
    }
    if (menuItem.recipeItems.length === 0) {
      throw new AppError(
        422,
        "RECIPE_MISSING",
        `"${menuItem.name}" has no recipe defined; cannot deduct inventory`,
      )
    }

    for (const recipe of menuItem.recipeItems) {
      const ingredient = recipe.ingredient
      if (!isConvertible(recipe.unit, ingredient.baseUnit)) {
        throw new AppError(
          422,
          "UNIT_MISMATCH",
          `Recipe for "${menuItem.name}" uses ${recipe.unit} for ${ingredient.name}, ` +
            `which is incompatible with its base unit ${ingredient.baseUnit}`,
        )
      }

      // qty per dish (in base unit) * number of dishes
      const perDishBase = convertQuantity(recipe.quantity, recipe.unit, ingredient.baseUnit)
      const lineQty = perDishBase.mul(line.quantity)

      const existing = demand.get(ingredient.id)
      if (existing) {
        existing.requiredQty = existing.requiredQty.add(lineQty)
      } else {
        demand.set(ingredient.id, {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          requiredQty: lineQty,
          baseUnit: ingredient.baseUnit,
        })
      }
    }
  }

  return demand
}

/**
 * Deduct the computed ingredient demand from a single outlet's live stock,
 * writing an immutable StockMovement (type SALE) per ingredient.
 *
 * Must be called inside a transaction. Throws 409 INSUFFICIENT_STOCK (with a
 * detailed shortage list) if any ingredient cannot satisfy demand.
 */
export async function deductStockForOrder(
  tx: Tx,
  params: {
    outletId: string
    orderId: string
    demand: Map<string, RequiredIngredient>
    createdById: string
  },
): Promise<void> {
  const { outletId, orderId, demand, createdById } = params

  const ingredientIds = [...demand.keys()]
  const stocks = await tx.outletStock.findMany({
    where: { outletId, ingredientId: { in: ingredientIds } },
    include: { ingredient: true },
  })
  const stockMap = new Map(stocks.map((s) => [s.ingredientId, s]))

  // First pass: validate availability and collect shortages.
  const shortages: { ingredient: string; required: string; available: string; unit: string }[] = []
  for (const req of demand.values()) {
    const stock = stockMap.get(req.ingredientId)
    const onHandBase = stock
      ? convertQuantity(stock.quantityOnHand, stock.unit, req.baseUnit)
      : new Prisma.Decimal(0)
    if (onHandBase.lessThan(req.requiredQty)) {
      shortages.push({
        ingredient: req.ingredientName,
        required: req.requiredQty.toString(),
        available: onHandBase.toString(),
        unit: req.baseUnit,
      })
    }
  }

  if (shortages.length > 0) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "Not enough stock to confirm this order", {
      shortages,
    })
  }

  // Second pass: apply deductions + ledger entries.
  for (const req of demand.values()) {
    const stock = stockMap.get(req.ingredientId)!
    // Amount to subtract, expressed in the stock row's own unit.
    const deductInStockUnit = convertQuantity(req.requiredQty, req.baseUnit, stock.unit)
    const newBalance = stock.quantityOnHand.sub(deductInStockUnit)

    await tx.outletStock.update({
      where: { id: stock.id },
      data: { quantityOnHand: newBalance },
    })

    await tx.stockMovement.create({
      data: {
        outletId,
        ingredientId: req.ingredientId,
        type: StockMovementType.SALE,
        quantity: deductInStockUnit.negated(), // negative = stock out
        unit: stock.unit,
        unitCost: stock.ingredient.averageCost,
        balanceAfter: newBalance,
        orderId,
        createdById,
        note: "Auto deduction on order confirmation",
      },
    })
  }
}

/**
 * Reverse a previously-deducted order (used when a confirmed order is
 * cancelled). Re-reads the SALE movements for the order and restores stock,
 * writing compensating ADJUSTMENT movements. Must run inside a transaction.
 */
export async function restockForCancelledOrder(
  tx: Tx,
  params: { outletId: string; orderId: string; createdById: string },
): Promise<void> {
  const { outletId, orderId, createdById } = params

  const saleMovements = await tx.stockMovement.findMany({
    where: { orderId, type: StockMovementType.SALE },
  })

  for (const mv of saleMovements) {
    const stock = await tx.outletStock.findUnique({
      where: { ingredientId_outletId: { ingredientId: mv.ingredientId, outletId } },
    })
    if (!stock) continue

    // mv.quantity was negative; restoring adds back the absolute amount.
    const restoreInStockUnit = convertQuantity(mv.quantity.abs(), mv.unit, stock.unit)
    const newBalance = stock.quantityOnHand.add(restoreInStockUnit)

    await tx.outletStock.update({
      where: { id: stock.id },
      data: { quantityOnHand: newBalance },
    })

    await tx.stockMovement.create({
      data: {
        outletId,
        ingredientId: mv.ingredientId,
        type: StockMovementType.ADJUSTMENT,
        quantity: restoreInStockUnit, // positive = stock back in
        unit: stock.unit,
        unitCost: mv.unitCost,
        balanceAfter: newBalance,
        orderId,
        createdById,
        note: "Restock from cancelled order",
      },
    })
  }
}
