import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { BadRequest } from "../lib/errors.js";

/**
 * Validates and replaces req.body with the parsed/typed result.
 * Keeps controllers free of repetitive input checking.
 */
export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        throw BadRequest("Validation failed", err.flatten().fieldErrors);
      }
      throw err;
    }
  };
