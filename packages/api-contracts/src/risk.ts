import { z } from "zod";
import { MarketRiskSchema, VenueStateSchema } from "./market.js";
import { MarketStateSchema } from "@perps-risk/types";

export { MarketRiskSchema, VenueStateSchema };

const structuredDivergenceMetric = z
  .object({
    value: z.number().finite().nullable(),
    score: z.number().min(0).max(100).nullable(),
    weight: z.number().positive(),
    contribution: z.number().min(0).max(100).nullable(),
    driver: z.string().optional(),
  })
  .strict();

const divergenceMetric = z.preprocess((val) => {
  if (typeof val === "number") {
    return {
      value: val,
      score: null,
      weight: 1.0,
      contribution: null,
    };
  }
  return val;
}, structuredDivergenceMetric);


export const EcosystemRiskSchema = z
  .object({
    asset: z.string(),
    timestamp: z.string().datetime({ offset: true }),
    venueCount: z.number().int().nonnegative(),
    ecosystemScore: z.number().int().min(0).max(100).nullable(),
    ecosystemLevel: z.enum(["low", "medium", "high", "critical"]).nullable(),
    venueSnapshots: z.array(
      z
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
        .strict(),
    ),
    divergence: z
      .object({
        price: divergenceMetric.nullable(),
        funding: divergenceMetric.nullable(),
        oiConcentration: divergenceMetric.nullable(),
        liquiditySpread: divergenceMetric.nullable(),
        liquidationConcentration: divergenceMetric.nullable(),
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
