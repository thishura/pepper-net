// Shared domain types for the PepperNet POS frontend. These mirror the
// Express API contract (server/src/modules/orders) so the client and backend
// stay in sync.

export type OrderType = "TAKEAWAY" | "DINE_IN" | "DELIVERY"

export type OrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "IN_KITCHEN"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"

export interface Outlet {
  id: string
  code: string
  name: string
  currency: string
  /** Tax rate as a percentage, e.g. 8 means 8%. */
  taxRate: number
  /** Service charge as a percentage, e.g. 10 means 10%. */
  serviceCharge: number
}

export interface MenuCategory {
  id: string
  name: string
  sortOrder: number
}

export interface MenuItem {
  id: string
  outletId: string
  categoryId: string
  name: string
  description?: string
  /** Unit price in the outlet's currency. */
  price: number
  imageUrl?: string
  isAvailable: boolean
  /** Optional spice level for Sri Lankan menu items (0-3). */
  spiceLevel?: number
}

export interface CartLine {
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
  notes?: string
}

export interface OrderTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceCharge: number
  totalAmount: number
}

/** Request body for POST /orders (matches createOrderBody on the server). */
export interface CreateOrderRequest {
  outletId: string
  type: OrderType
  customerId?: string
  notes?: string
  discountAmount: number
  confirm: boolean
  items: { menuItemId: string; quantity: number; notes?: string }[]
}

export interface OrderResponse {
  id: string
  orderNumber: string
  status: OrderStatus
  type: OrderType
  subtotal: string
  discountAmount: string
  taxAmount: string
  serviceCharge: string
  totalAmount: string
  items: {
    id: string
    nameSnapshot: string
    unitPrice: string
    quantity: number
    lineTotal: string
    notes?: string | null
  }[]
}
