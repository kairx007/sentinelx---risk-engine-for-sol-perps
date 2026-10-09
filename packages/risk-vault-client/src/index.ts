import idl from "../idl/risk_vault.json";

export const RISK_VAULT_IDL_ADDRESS = idl.address;
export const RISK_VAULT_IDL_VERSION = idl.metadata.version;
export const RISK_VAULT_IDL_SPEC = idl.metadata.spec;

export const RISK_VAULT_IDL_ACCOUNT_DISCRIMINATORS = Object.fromEntries(
  idl.accounts.map((account) => [account.name, account.discriminator]),
);
export const RISK_VAULT_IDL_INSTRUCTION_DISCRIMINATORS = Object.fromEntries(
  idl.instructions.map((instruction) => [
    instruction.name,
    instruction.discriminator,
  ]),
);
