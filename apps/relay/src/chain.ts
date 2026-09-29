import { createRelay14Chain, DEFAULT_CHAIN_ID } from "@relay-14/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { type ChainReader } from "./store.js";

export function createRelay14PublicClient(env: { CHAIN_ID: string; RPC_URL: string }): PublicClient {
  const parsed = Number(env.CHAIN_ID);
  const chainId = Number.isInteger(parsed) ? parsed : DEFAULT_CHAIN_ID;
  const chain = createRelay14Chain({ chainId, rpcUrl: env.RPC_URL });
  return createPublicClient({
    chain,
    transport: http(env.RPC_URL),
  });
}

export function createViemChainReader(client: PublicClient): ChainReader {
  return {
    async getTransactionCount(address) {
      return client.getTransactionCount({ address, blockTag: "pending" });
    },
    async getBalance(address) {
      return client.getBalance({ address });
    },
  };
}
