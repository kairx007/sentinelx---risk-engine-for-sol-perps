import driftFixture from "./fixtures/market-state-drift.json";
import jupiterFixture from "./fixtures/market-state-jupiter.json";
import invalidTimestampFixture from "./fixtures/market-state-invalid-timestamp.json";
import invalidVenueFixture from "./fixtures/market-state-invalid-venue.json";
import phoenixFixture from "./fixtures/market-state-phoenix.json";
import { MarketStateSchema, VenueSchema } from "@perps-risk/types";
import { describe, expect, it } from "vitest";

const validFixtures = [
  { venue: "drift", state: driftFixture },
  { venue: "phoenix", state: phoenixFixture },
  { venue: "jupiter", state: jupiterFixture },
];

describe("canonical MarketState contract", () => {
  it.each(validFixtures)("accepts a valid $venue fixture", ({ state }) => {
    expect(MarketStateSchema.safeParse(state).success).toBe(true);
  });

  it("accepts unavailable measurements represented as null", () => {
    const result = MarketStateSchema.safeParse(jupiterFixture);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.positioning.totalOpenInterest).toBeNull();
      expect(result.data.funding.rate).toBeNull();
      expect(result.data.liquidation.totalVolume).toBeNull();
    }
  });

  it("rejects missing required fields and incorrect field types", () => {
    const missingRequiredField = structuredClone(driftFixture) as Record<
      string,
      unknown
    >;
    delete (missingRequiredField.market as Record<string, unknown>).symbol;

    const wrongFieldType = {
      ...driftFixture,
      price: { ...driftFixture.price, lastPrice: "152.42" },
    };

    expect(MarketStateSchema.safeParse(missingRequiredField).success).toBe(
      false,
    );
    expect(MarketStateSchema.safeParse(wrongFieldType).success).toBe(false);
  });

  it("rejects unsupported venues and malformed timestamps", () => {
    expect(VenueSchema.safeParse("unknown-venue").success).toBe(false);
    expect(MarketStateSchema.safeParse(invalidVenueFixture).success).toBe(
      false,
    );
    expect(MarketStateSchema.safeParse(invalidTimestampFixture).success).toBe(
      false,
    );
  });

  it("rejects unrecognized properties to keep the contract explicit", () => {
    const stateWithUnknownProperty = {
      ...driftFixture,
      price: { ...driftFixture.price, venueSpecificField: "raw SDK value" },
    };

    expect(MarketStateSchema.safeParse(stateWithUnknownProperty).success).toBe(
      false,
    );
  });
});
