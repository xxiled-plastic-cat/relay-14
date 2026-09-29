import { createPublicClient, http, isAddress, type Address, type LocalAccount, type PublicClient } from "viem";
import {
  NETWORK,
  PAYMENT_HEADER,
  SCHEME,
  X402_VERSION,
  createRelay14Chain,
  encodeJsonHeader,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "@relay-14/shared";

export async function createPaymentHeader(
  paymentRequired: PaymentRequired,
  account: LocalAccount,
  publicClient: PublicClient,
): Promise<string> {
  const requirement = selectRequirement(paymentRequired);
  const signedTx = await signNativeTransfer(requirement, account, publicClient);
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: SCHEME,
    network: requirement.network,
    payload: { signedTx },
  };
  return encodeJsonHeader(payload);
}

export async function fetchWithPayment(
  url: string,
  account: LocalAccount,
  init?: RequestInit,
  publicClient?: PublicClient,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) {
    return first;
  }

  const paymentRequired = (await first.json()) as PaymentRequired;
  const client = publicClient ?? createDefaultClient();
  const header = await createPaymentHeader(paymentRequired, account, client);
  const headers = new Headers(init?.headers);
  headers.set(PAYMENT_HEADER, header);
  return fetch(url, { ...init, headers });
}

function selectRequirement(paymentRequired: PaymentRequired): PaymentRequirements {
  const match = paymentRequired.accepts?.find(
    (entry) => entry.scheme === SCHEME && entry.network === NETWORK,
  );
  if (!match) {
    throw new Error(`No ${SCHEME} requirement for ${NETWORK}`);
  }
  if (!isAddress(match.payTo)) {
    throw new Error("payTo is not an address");
  }
  if (!/^\d+$/.test(match.maxAmountRequired)) {
    throw new Error("maxAmountRequired is not a wei amount");
  }
  return match;
}

async function signNativeTransfer(
  requirement: PaymentRequirements,
  account: LocalAccount,
  publicClient: PublicClient,
): Promise<`0x${string}`> {
  const to = requirement.payTo as Address;
  const value = BigInt(requirement.maxAmountRequired);
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? (await publicClient.getGasPrice());
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  const gas = await publicClient.estimateGas({
    account: account.address,
    to,
    value,
  });
  const chainId = publicClient.chain?.id;
  if (chainId === undefined) {
    throw new Error("Public client is missing a chain id");
  }

  return account.signTransaction({
    type: "eip1559",
    chainId,
    to,
    value,
    data: "0x",
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
}

function createDefaultClient(): PublicClient {
  const chain = createRelay14Chain();
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
}
