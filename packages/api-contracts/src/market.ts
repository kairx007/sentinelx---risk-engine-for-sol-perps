import { z } from "zod";
import { MarketStateSchema } from "@perps-risk/types";

const level = z.enum(["low", "medium", "high", "critical"]);
const component = z
  .object({ score: z.number().finite(), level, drivers: z.array(z.string()) })
  .strict();

export const MarketRiskSchema = z
  .object({
    overallScore: z.number().int().min(0).max(100),
    level,
    components: z.record(z.string(), component),
    topDrivers: z.array(z.string()),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const VenueStateSchema = MarketStateSchema;
