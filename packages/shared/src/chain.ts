import { defineChain, type Chain } from "viem";
import { DEFAULT_CHAIN_ID, DEFAULT_RPC_URL, EXPLORER_URL } from "./constants.js";

export function createRelay14Chain(options?: { chainId?: number; rpcUrl?: string }): Chain {
  const chainId = options?.chainId ?? DEFAULT_CHAIN_ID;
  const rpcUrl = options?.rpcUrl ?? DEFAULT_RPC_URL;
  return defineChain({
    id: chainId,
    name: "LitVM LiteForge",
    nativeCurrency: {
      name: "zkLTC",
      symbol: "zkLTC",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: { name: "LiteForge", url: EXPLORER_URL },
    },
  });
}
