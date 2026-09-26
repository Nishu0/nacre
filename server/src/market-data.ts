export const POOLS = [
  {
    id: "usdc-weth-001",
    symbol: "USDC/WETH",
    feeTier: "0.01%",
    feeRate: 0.0001,
    address: "0xe0554a476a092703abdb3ef35c80e0d76d32939f",
    llamaId: "8b3ed515-5e6f-449a-9b64-25113cda7a29",
  },
  {
    id: "usdc-weth-005",
    symbol: "USDC/WETH",
    feeTier: "0.05%",
    feeRate: 0.0005,
    address: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
    llamaId: "665dc8bc-c79d-4800-97f7-304bf368e547",
  },
  {
    id: "weth-usdt-03",
    symbol: "WETH/USDT",
    feeTier: "0.30%",
    feeRate: 0.003,
    address: "0x4e68ccd3e89f51c3074ca5072bbac773960dfa36",
    llamaId: "fc9f488e-8183-416f-a61e-4e5c571d4395",
  },
] as const;

export type PoolId = (typeof POOLS)[number]["id"];

export type Observation = {
  date: string;
  apyBasePct: number;
  tvlUsd: number;
  volumeUsd: number;
  grossPoolFeesUsd: number;
};

export type PoolHistory = {
  id: PoolId;
  observations: Observation[];
};

export type Snapshot = {
  source: "DefiLlama Yields API + GeckoTerminal OHLCV API";
  capturedAt: string;
  from: string;
  through: string;
  pools: PoolHistory[];
};
