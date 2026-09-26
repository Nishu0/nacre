const indexingDelay = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /NOT_MINTED|header not found|unknown block|block.*not found|could not be found|missing trie node/i.test(message);
};

/** A receipt can reach one RPC replica before another replica has its state.
 * Always read the receipt's block, never an independently resolved `latest`.
 * Retry only indexing failures; wrong-owner/pool checks stay outside this helper.
 */
export async function readAtMintBlock<T>(
  blockNumber: bigint,
  read: (blockNumber: bigint) => Promise<T>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const delays = [300, 800, 1600];
  for (let attempt = 0; ; attempt++) {
    try { return await read(blockNumber); }
    catch (error) {
      if (!indexingDelay(error)) throw error;
      if (attempt === delays.length) {
        throw new Error("Your mint succeeded, but the RPC has not indexed the position yet. Use Retry saving position; do not mint again.");
      }
      await pause(delays[attempt]);
    }
  }
}
