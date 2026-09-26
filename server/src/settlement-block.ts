// Find a monotonic state transition without scanning millions of event blocks.
export async function settlementBlock(latest: bigint, settled: (block: bigint) => Promise<boolean>) {
  if (!await settled(latest)) throw new Error("Policy is not settled at the requested block");
  let high = latest;
  let step = 1n;
  let low = latest > step ? latest - step : 0n;
  while (await settled(low)) {
    high = low;
    if (low === 0n) return 0n;
    step *= 2n;
    low = latest > step ? latest - step : 0n;
  }
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (await settled(middle)) high = middle;
    else low = middle;
  }
  return high;
}
