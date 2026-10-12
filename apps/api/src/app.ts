import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import { ApiError } from "./errors.js";
import { DashboardSnapshotSchema } from "../../../packages/api-contracts/src/dashboard.js";
import {
  createDefaultMarketService,
  type ApiVenue,
  type MarketService,
} from "./market-service.js";

const supportedVenues = new Set<ApiVenue>(["velocity", "phoenix"]);

function requiredQuery(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      `Query parameter "${name}" is required.`,
    );
  }
  return value.trim();
}

function parseVenue(value: string): ApiVenue {
  if (!supportedVenues.has(value as ApiVenue)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Venue must be velocity or phoenix.",
    );
  }
  return value as ApiVenue;
}

function pathParams(request: Request): { venue: ApiVenue; symbol: string } {
  const venueValue = request.params.venue;
  const symbolValue = request.params.symbol;
  if (typeof venueValue !== "string" || typeof symbolValue !== "string") {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Venue and market symbol are required.",
    );
  }
  const venue = parseVenue(venueValue);
  const symbol = symbolValue.trim();
  if (!symbol) {
    throw new ApiError(400, "INVALID_REQUEST", "Market symbol is required.");
  }
  return { venue, symbol };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: { code, message, timestamp: new Date().toISOString() },
  });
}

export function createApiApp(
  service: MarketService = createDefaultMarketService(),
): Express {
  const app = express();

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/markets", async (request, response) => {
    const venue = parseVenue(requiredQuery(request.query.venue, "venue"));
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json([await service.getMarketState(venue, symbol)]);
  });

  app.get("/markets/:venue/:symbol/risk", async (request, response) => {
    const { venue, symbol } = pathParams(request);
    response.json(await service.getMarketRisk(venue, symbol));
  });

  app.get("/markets/:venue/:symbol", async (request, response) => {
    const { venue, symbol } = pathParams(request);
    response.json(await service.getMarketState(venue, symbol));
  });

  app.get("/ecosystem/risk", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json(await service.getEcosystemRisk(symbol));
  });

  app.get("/ecosystem/contagion", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json(await service.getContagionRisk(symbol));
  });

  app.get("/dashboard/snapshot", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    const snapshot = await service.getDashboardSnapshot(symbol);
    response.json(DashboardSnapshotSchema.parse(snapshot));
  });

  app.post("/faucet/usdc", express.json(), async (request, response, next) => {
    try {
      const recipientStr = request.body?.recipient;
      if (!recipientStr || typeof recipientStr !== "string") {
        throw new ApiError(400, "INVALID_REQUEST", "Recipient address is required.");
      }

      const {
        Connection,
        PublicKey,
        Keypair,
        Transaction,
        sendAndConfirmTransaction,
      } = await import("@solana/web3.js");
      const {
        getAssociatedTokenAddressSync,
        createAssociatedTokenAccountInstruction,
        createSplTokenTransferInstruction,
      } = await import("../../dashboard/src/solana/transactions.js");
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");

      const recipient = new PublicKey(recipientStr.trim());
      const collateralMintStr =
        process.env.VITE_COLLATERAL_MINT ||
        "49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx";
      const collateralMint = new PublicKey(collateralMintStr);

      const keypairPath =
        process.env.DEVNET_KEYPAIR_PATH ||
        path.join(os.homedir(), ".config/solana/id.json");
      if (!fs.existsSync(keypairPath)) {
        throw new ApiError(503, "VENUE_UNAVAILABLE", "Deployer faucet keypair not found.");
      }
      const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
      const payer = Keypair.fromSecretKey(new Uint8Array(secret));

      const rpcUrl =
        process.env.VITE_CHAIN_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const senderAta = getAssociatedTokenAddressSync(collateralMint, payer.publicKey);
      const recipientAta = getAssociatedTokenAddressSync(collateralMint, recipient);

      const tx = new Transaction();
      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      if (!recipientAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey,
            recipientAta,
            recipient,
            collateralMint,
          ),
        );
      }

      // Transfer 100 fake USDC (100 * 1_000_000 atoms)
      const amountAtoms = 100_000_000n;
      tx.add(
        createSplTokenTransferInstruction(
          senderAta,
          recipientAta,
          payer.publicKey,
          amountAtoms,
        ),
      );

      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });

      response.json({
        success: true,
        amount: 100,
        recipient: recipient.toBase58(),
        txSignature: sig,
      });
    } catch (err: any) {
      if (err instanceof ApiError) {
        next(err);
      } else {
        next(new ApiError(503, "VENUE_UNAVAILABLE", err.message || "Failed to airdrop test USDC."));
      }
    }
  });

  app.post("/risk/publish-pulse", express.json(), async (_request, response, next) => {
    try {
      const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
      const {
        deriveVaultAddress,
        deriveRiskStateAddress,
        buildUpdateRiskStateInstruction,
        decodeRiskState,
      } = await import("../../risk-publisher/src/risk-state.js");
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");

      const defaultRiskKeypairPath = path.resolve(
        process.cwd(),
        "anchor/risk_vault/target/deploy/risk_authority-keypair.json",
      );
      const keypairPath =
        process.env.RISK_AUTHORITY_KEYPAIR_PATH ||
        (fs.existsSync(defaultRiskKeypairPath)
          ? defaultRiskKeypairPath
          : path.join(os.homedir(), ".config/solana/id.json"));
      if (!fs.existsSync(keypairPath)) {
        throw new ApiError(503, "VENUE_UNAVAILABLE", "Risk authority keypair not found.");
      }
      const secret = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
      const signer = Keypair.fromSecretKey(new Uint8Array(secret));

      const collateralMintStr =
        process.env.VITE_COLLATERAL_MINT ||
        "49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx";
      const collateralMint = new PublicKey(collateralMintStr);
      const [vault] = deriveVaultAddress(collateralMint);
      const [riskStateAddr] = deriveRiskStateAddress(vault);

      const rpcUrl =
        process.env.VITE_CHAIN_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const currentAccount = await connection.getAccountInfo(riskStateAddr);
      if (!currentAccount) {
        throw new ApiError(503, "VENUE_UNAVAILABLE", "On-chain RiskState account not found.");
      }
      const current = decodeRiskState(currentAccount.data);

      const now = Math.floor(Date.now() / 1000);
      const nextNonce = current.nonce + 1n;

      const updateIx = buildUpdateRiskStateInstruction(vault, signer.publicKey, {
        riskLevel: current.riskLevel,
        riskScore: current.riskScore,
        contagionState: current.contagionState,
        maxLeverageX100: current.maxLeverageX100,
        observedAt: now,
        nonce: nextNonce,
      });

      const tx = new Transaction().add(updateIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [signer], {
        commitment: "confirmed",
      });

      response.json({
        success: true,
        updatedAt: now,
        nonce: nextNonce.toString(),
        txSignature: sig,
      });
    } catch (err: any) {
      if (err instanceof ApiError) {
        next(err);
      } else {
        next(new ApiError(503, "VENUE_UNAVAILABLE", err.message || "Failed to publish fresh risk state."));
      }
    }
  });

  app.use((_request, response) => {
    sendError(response, 404, "NOT_FOUND", "Route not found.");
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    if (error instanceof URIError) {
      sendError(response, 400, "INVALID_REQUEST", "Request path is malformed.");
      return;
    }

    console.error("Unhandled API error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Internal server error.");
  };

  app.use(errorHandler);
  return app;
}
