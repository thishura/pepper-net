import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2),
  phone: z.string().min(7).optional(),
  // Only a SUPER_ADMIN may set a role other than CASHIER (enforced in controller).
  role: z.enum(["SUPER_ADMIN", "OUTLET_MANAGER", "CASHIER", "CHEF"]).optional(),
  // Optional initial outlet assignments.
  outletIds: z.array(z.string()).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
