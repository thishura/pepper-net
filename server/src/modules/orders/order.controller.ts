import { Request, Response } from "express"
import { OrderStatus } from "@prisma/client"
import { ZodError } from "zod"
import { asyncHandler } from "../../lib/async-handler.js"
import { BadRequest } from "../../lib/errors.js"
import { listOrdersQuery } from "./order.schemas.js"
import * as orderService from "./order.service.js"

export const createOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createOrder(req.body, req.auth!.userId)
  res.status(201).json({ data: order })
})

export const getOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.getOrder(req.params.id)
  res.json({ data: order })
})

export const listOrdersHandler = asyncHandler(async (req: Request, res: Response) => {
  let query
  try {
    query = listOrdersQuery.parse(req.query)
  } catch (err) {
    if (err instanceof ZodError) {
      throw BadRequest("Validation failed", err.flatten().fieldErrors)
    }
    throw err
  }
  const result = await orderService.listOrders({
    outletId: query.outletId,
    status: query.status as OrderStatus | undefined,
    take: query.take,
    skip: query.skip,
  })
  res.json(result)
})

export const confirmOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.transitionOrder(
    req.params.id,
    OrderStatus.CONFIRMED,
    req.auth!.userId,
  )
  res.json({ data: order })
})

export const transitionOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.transitionOrder(
    req.params.id,
    req.body.to as OrderStatus,
    req.auth!.userId,
  )
  res.json({ data: order })
})
