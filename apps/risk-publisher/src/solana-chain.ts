import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { RiskStateChain } from "./publisher.js";
import { RISK_VAULT_PROGRAM_ID } from "./risk-state.js";

export function createSolanaRiskStateChain(
  connection: Connection,
  signer: Keypair,
): RiskStateChain {
  return {
    async getAccount(address) {
      const account = await connection.getAccountInfo(address, "confirmed");
      return account ? { owner: account.owner, data: account.data } : null;
    },
    async submitAndConfirm(instruction: TransactionInstruction) {
      if (!instruction.programId.equals(RISK_VAULT_PROGRAM_ID)) {
        throw new Error(
          "Refusing to submit an instruction for an unexpected program",
        );
      }
      const transaction = new Transaction().add(instruction);
      transaction.feePayer = signer.publicKey;
      return sendAndConfirmTransaction(connection, transaction, [signer], {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });
    },
  };
}
