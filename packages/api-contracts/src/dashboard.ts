import { z } from "zod";
import { ContagionRiskSchema, EcosystemRiskSchema } from "./risk.js";
import { MarketRiskSchema } from "./market.js";
import { MarketStateSchema } from "@perps-risk/types";

const PolicyDecisionSchema = z
  .object({
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    riskScore: z.number().int().min(0).max(100),
    contagionState: z.enum(["NONE", "ISOLATED", "DEVELOPING", "ACTIVE"]),
    maxLeverageX100: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
  })
  .strict();

export const SnapshotVenueSchema = z
  .object({
    venue: z.enum(["velocity", "phoenix"]),
    status: z.enum(["available", "stale", "invalid", "unavailable"]),
    state: MarketStateSchema.nullable(),
    risk: MarketRiskSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === "available" &&
      (!value.state || !value.risk || value.error !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Available venues require state and risk without an error.",
      });
    }
    if (
      value.status === "stale" &&
      (!value.state || !value.risk || value.error === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Stale venues require retained state and risk with a stale reason.",
      });
    }
    if (value.status === "invalid" && value.error === null) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid venues require a validation reason.",
      });
    }
    if (value.status === "available" && value.state) {
      const { sourceAgeMs, staleAfterMs } = value.state.metadata.freshness;
      if (
        sourceAgeMs === null ||
        staleAfterMs === null ||
        sourceAgeMs > staleAfterMs
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Available venues must have fresh observations.",
        });
      }
    }
    if (value.status === "stale" && value.state) {
      const { sourceAgeMs, staleAfterMs } = value.state.metadata.freshness;
      if (
        sourceAgeMs !== null &&
        staleAfterMs !== null &&
        sourceAgeMs <= staleAfterMs
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Stale venues cannot have fresh observations.",
        });
      }
    }
    if (
      value.status === "unavailable" &&
      (value.state !== null || value.risk !== null || value.error === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Unavailable venues require null data and an error.",
      });
    }
  });

export const DashboardSnapshotSchema = z
  .object({
    source: z.literal("LIVE"),
    symbol: z.string().trim().min(1),
    collectedAt: z.string().datetime({ offset: true }),
    venues: z.array(SnapshotVenueSchema).length(2),
    ecosystem: EcosystemRiskSchema.nullable(),
    contagion: ContagionRiskSchema.nullable(),
    policy: z
      .object({
        status: z.enum(["available", "unavailable"]),
        decision: PolicyDecisionSchema.nullable(),
        reason: z.string().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = value.venues.map((venue) => venue.venue);
    if (
      !names.includes("velocity") ||
      !names.includes("phoenix") ||
      new Set(names).size !== 2
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Snapshot must include Velocity and Phoenix exactly once.",
      });
    }
    for (const venue of value.venues) {
      if (
        venue.state &&
        (venue.state.market.venue !== venue.venue ||
          venue.state.market.symbol.trim().toUpperCase() !==
            value.symbol.trim().toUpperCase()) &&
        venue.status !== "invalid"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Market identity mismatches must be marked invalid.",
        });
      }
    }
    if (
      value.policy.status === "available" &&
      (value.policy.decision === null || value.policy.reason !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Available policy requires a decision and no reason.",
      });
    }
    if (
      value.policy.status === "available" &&
      (value.ecosystem === null || value.contagion === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Policy requires available ecosystem and contagion inputs.",
      });
    }
    if (
      value.policy.status === "unavailable" &&
      (value.policy.decision !== null || value.policy.reason === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Unavailable policy requires a reason and null decision.",
      });
    }
  });

export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
