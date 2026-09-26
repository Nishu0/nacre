export const POOLS = [
  {
    id: "usdc-weth-005",
    symbol: "USDC/WETH",
    feeTier: "0.05%",
    llamaId: "665dc8bc-c79d-4800-97f7-304bf368e547",
  },
  {
    id: "wbtc-weth-005",
    symbol: "WBTC/WETH",
    feeTier: "0.05%",
    llamaId: "d59a5728-d391-4989-86f6-a94e11e0eb3b",
  },
  {
    id: "usdc-usdt-001",
    symbol: "USDC/USDT",
    feeTier: "0.01%",
    llamaId: "e737d721-f45c-40f0-9793-9f56261862b9",
  },
] as const;

export type PoolId = (typeof POOLS)[number]["id"];

export type Observation = {
  date: string;
  apyBasePct: number;
  tvlUsd: number;
};

export type PoolHistory = {
  id: PoolId;
  observations: Observation[];
};

export type Snapshot = {
  source: "DefiLlama Yields API";
  capturedAt: string;
  from: string;
  through: string;
  pools: PoolHistory[];
};
