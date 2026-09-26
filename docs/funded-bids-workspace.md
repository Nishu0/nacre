# Funded bids workspace

The dashboard now starts with wallet balances. Underwriters open **Coverage bids**, choose a price range, nUSDC capital, duration and premium, then approve and fund an on-chain bid. The displayed ticks are the exact bins being offered.

Investors select an available bid from a different wallet. Its ticks and duration are fixed in the position form. Closed, empty, self-funded and out-of-range bids cannot be selected. Minting and coverage requests refresh bid availability before signing; a fee target larger than remaining capacity is blocked. Availability is not reserved by selecting a card or minting: the existing contract reserves collateral atomically when coverage is purchased.

The investor flow is **select bid → mint the matching LP position → request coverage → buy the funded offer**. Requesting transfers the NFT into the policy vault. The existing one-hour cancellation path and policy settlement remain in Portfolio. The contract also enforces its per-position maximum fee cap.

## Local clean start

`bun server/src/reset-workspace.ts` is an explicit maintenance operation, not a server startup hook. It backs up SQLite and archives currently known market IDs, offer addresses, request IDs and position IDs. New records remain visible. Do not rerun it unless another reset is intended.

The September 27 reset archived three market records, five position records, two offers and one request. Backup: `server/data/nacre-before-bids-1790446263732.sqlite` (ignored by Git).

No on-chain assets were burned, moved, or refunded. nUSDC and nWETH addresses, faucet balances and native ETH balances are unchanged. Old positions/requests/offers remain in their original contracts. The technical nWETH pool is reused for execution and is not listed as a legacy dashboard pool. Its configuration is available to the bid form at `GET /api/bid-market`.

The `workspace_archives` table records the hidden IDs; `market_archives` records hidden market IDs. Removing a particular archive entry restores its app visibility if recovery is needed. The old request can still be cancelled after its deadline; offer owners can still call `closeAndWithdraw`. Resetting the app does not withdraw those funds automatically.
