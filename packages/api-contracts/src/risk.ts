import { z } from "zod";
import { MarketRiskSchema } from "./market.js";
import { MarketStateSchema } from "@perps-risk/types";

const venueSnapshot = z
  .object({
    venue: z.enum(["drift", "velocity", "phoenix", "jupiter"]),
    symbol: z.string(),
    state: MarketStateSchema,
    risk: MarketRiskSchema.nullable(),
    metrics: z
      .object({
        price: z.number().finite().nullable(),
        oi: z.number().finite().nullable(),
        longOi: z.number().finite().nullable(),
        shortOi: z.number().finite().nullable(),
        funding: z.number().finite().nullable(),
        fundingPeriod: z.number().finite().nullable(),
        spread: z.number().finite().nullable(),
        liquidations: z.number().finite().nullable(),
      })
      .strict(),
  })
  .strict();

export const EcosystemRiskSchema = z
  .object({
    asset: z.string(),
    timestamp: z.string().datetime({ offset: true }),
    venueCount: z.number().int().nonnegative(),
    ecosystemScore: z.number().int().min(0).max(100).nullable(),
    ecosystemLevel: z.enum(["low", "medium", "high", "critical"]).nullable(),
    venueSnapshots: z.array(venueSnapshot),
    divergence: z
      .object({
        price: z.number().finite().nullable(),
        funding: z.number().finite().nullable(),
        oiConcentration: z.number().finite().nullable(),
        liquiditySpread: z.number().finite().nullable(),
        liquidationConcentration: z.number().finite().nullable(),
      })
      .strict(),
    riskDrivers: z.array(z.string()),
  })
  .strict();

export const ContagionRiskSchema = z
  .object({
    status: z.enum(["NONE", "ISOLATED", "DEVELOPING", "ACTIVE"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    affectedVenues: z.array(
      z.enum(["drift", "velocity", "phoenix", "jupiter"]),
    ),
    drivers: z.array(z.string()),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();
