/** A receipt can arrive before another RPC replica can read its block. */
export async function readConfirmedBalance(
  blockNumber: bigint,
  read: (blockNumber: bigint) => Promise<bigint>,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<bigint> {
  const delays = [400, 900, 1800, 3000];
  for (let attempt = 0; ; attempt++) {
    try { return await read(blockNumber); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === delays.length || !/block.*not found|header not found|unknown block|could not be found|missing trie node/i.test(message)) throw error;
      await pause(delays[attempt]);
    }
  }
}
