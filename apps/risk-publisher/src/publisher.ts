import type { RiskPolicyDecision } from "@perps-risk/cross-venue";
import { PublicKey } from "@solana/web3.js";
import {
  buildUpdateRiskStateInstruction,
  decodeRiskState,
  decodeVaultIdentity,
  deriveRiskStateAddress,
  deriveVaultAddress,
  RISK_VAULT_PROGRAM_ID,
  riskStateMatchesDecision,
  type RiskStateSnapshot,
} from "./risk-state.js";

export interface RiskStateChain {
  getAccount(
    address: PublicKey,
  ): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  submitAndConfirm(
    instruction: ReturnType<typeof buildUpdateRiskStateInstruction>,
  ): Promise<string>;
}

export type PublishResult =
  | { status: "published"; nonce: bigint; signature: string }
  | { status: "already-current"; nonce: bigint };

function samePolicyExceptObservation(
  state: RiskStateSnapshot,
  decision: RiskPolicyDecision,
): boolean {
  return (
    state.riskLevel === decision.riskLevel &&
    state.riskScore === decision.riskScore &&
    state.contagionState === decision.contagionState &&
    state.maxLeverageX100 === decision.maxLeverageX100
  );
}

export async function publishRiskPolicy(
  chain: RiskStateChain,
  vault: PublicKey,
  signer: PublicKey,
  decision: RiskPolicyDecision,
): Promise<PublishResult> {
  const vaultAccount = await chain.getAccount(vault);
  if (!vaultAccount) throw new Error("Vault account is unavailable");
  if (!vaultAccount.owner.equals(RISK_VAULT_PROGRAM_ID)) {
    throw new Error("Vault account is not owned by the Risk Vault program");
  }
  const identity = decodeVaultIdentity(Buffer.from(vaultAccount.data));
  if (!identity.riskAuthority.equals(signer)) {
    throw new Error(
      "Configured risk_authority does not match the publisher signer",
    );
  }

  const [derivedVault, expectedVaultBump] = deriveVaultAddress(
    identity.collateralMint,
  );
  if (!derivedVault.equals(vault) || expectedVaultBump !== identity.bump) {
    throw new Error("Vault address does not match its collateral-mint PDA");
  }
  const [riskStateAddress, riskStateBump] = deriveRiskStateAddress(vault);
  const riskStateAccount = await chain.getAccount(riskStateAddress);
  if (!riskStateAccount) throw new Error("RiskState PDA is unavailable");
  if (!riskStateAccount.owner.equals(vaultAccount.owner)) {
    throw new Error("RiskState account is not owned by the Risk Vault program");
  }
  const current = decodeRiskState(Buffer.from(riskStateAccount.data));
  if (current.bump !== riskStateBump)
    throw new Error("RiskState PDA bump does not match its address");

  if (decision.observedAt < current.observedAt) {
    if (samePolicyExceptObservation(current, decision)) {
      return { status: "already-current", nonce: current.nonce };
    }
    throw new Error(
      "Refusing to publish a policy older than the on-chain observation",
    );
  }
  if (riskStateMatchesDecision(current, decision)) {
    return { status: "already-current", nonce: current.nonce };
  }
  if (current.nonce === 0xffff_ffff_ffff_ffffn) {
    throw new Error("RiskState nonce is exhausted");
  }
  const nonce = current.nonce + 1n;
  const instruction = buildUpdateRiskStateInstruction(vault, signer, {
    ...decision,
    nonce,
  });

  let signature: string;
  try {
    signature = await chain.submitAndConfirm(instruction);
  } catch (error) {
    // A concurrent publisher may have won the same nonce. Re-read before
    // reporting failure; never guess a nonce or silently skip ahead.
    const afterFailureAccount = await chain.getAccount(riskStateAddress);
    if (afterFailureAccount?.owner.equals(vaultAccount.owner)) {
      const afterFailure = decodeRiskState(
        Buffer.from(afterFailureAccount.data),
      );
      if (
        afterFailure.nonce === nonce &&
        riskStateMatchesDecision(afterFailure, decision)
      ) {
        return { status: "already-current", nonce };
      }
      if (afterFailure.nonce !== current.nonce) {
        throw new Error(
          `RiskState nonce changed concurrently (expected ${nonce}, found ${afterFailure.nonce})`,
          { cause: error },
        );
      }
    }
    throw error;
  }

  const confirmedAccount = await chain.getAccount(riskStateAddress);
  if (!confirmedAccount?.owner.equals(vaultAccount.owner)) {
    throw new Error(
      `Transaction ${signature} confirmed but RiskState account could not be verified`,
    );
  }
  const confirmed = decodeRiskState(Buffer.from(confirmedAccount.data));
  if (
    confirmed.nonce !== nonce ||
    !riskStateMatchesDecision(confirmed, decision)
  ) {
    throw new Error(
      `Transaction ${signature} confirmed but RiskState does not match the submitted policy`,
    );
  }
  return { status: "published", nonce, signature };
}
