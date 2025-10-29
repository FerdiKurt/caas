export interface VendorClient {
  quote(kg: number): Promise<{ costUsd: number }>;
  purchase(input: {
    protocolId?: string | null;
    txEventId?: string | null;
    kg: number;
  }): Promise<{ purchasedKg: number; costUsd: number; vendorRef?: string }>;
}

export function dollars(n: number, dp = 6): number {
  return Math.round(n * 10 ** dp) / 10 ** dp;
}
