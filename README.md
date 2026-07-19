# Progressive ICO Training Contract

A production-pattern-hardened ICO built for learning: tiered/progressive pricing, a
Merkle-gated presale, a soft cap with pull-based refunds, a hard cap on tokens sold, and
post-sale token vesting. Built with Hardhat 3 + Ignition + TypeScript tests.

## Features

- **Tiered progressive pricing** — the price per token rises as cumulative sales cross
  fixed thresholds. A purchase that would cross a tier boundary partial-fills at the
  cheaper tier and refunds the leftover ETH in the same transaction.
- **Presale whitelist (Merkle proof)** — a presale phase gated by a Merkle tree of
  allowed addresses, followed by a public phase open to everyone. Both phases draw from
  the same tier curve and hard cap.
- **Soft cap / hard cap** — the hard cap (last tier threshold) stops sales once the
  supply for sale is exhausted. If the soft cap (minimum ETH raised) isn't met by the
  end date, buyers pull-claim a full ETH refund instead of receiving tokens.
- **Vesting** — buyers don't receive tokens at purchase time. Tokens vest linearly after
  a cliff (anchored to the sale's end date) and are claimed over time.
- **Hardening**: `Ownable2Step` (two-step ownership transfer), `Pausable` (emergency
  stop on purchases/claims — refunds and owner withdrawals always stay callable),
  `ReentrancyGuard`, `SafeERC20`, checks-effects-interactions ordering everywhere ETH or
  tokens move, custom errors, and a pinned compiler version.

See the NatSpec comments in `contracts/ICO.sol` for the full rationale behind each
design decision (why vesting lives in the ICO contract instead of a separate vault, why
pricing is single-tier-per-purchase instead of a bonding curve, why `finalize()` is
permissionless, etc.) and its "risks / accepted limitations" notes (front-running bound
at tier boundaries, `.call`-based ETH transfers, tier rounding dust, the vesting clock's
anchor point, and the pause/refund asymmetry).

## Setup

```bash
npm install
npx hardhat compile
```

## Test

```bash
npx hardhat test
```

Test files under `test/`:
- `ICO.ts` — constructor validation and phase transitions
- `ICO.presale.ts` — Merkle whitelist gating and root rotation
- `ICO.tiers.ts` — tiered pricing, partial fills, hard cap
- `ICO.caps.ts` — finalize, soft-cap success/failure, refunds, unsold-token withdrawal
- `ICO.vesting.ts` — cliff + linear vesting math
- `ICO.pausable.ts` — pause/unpause and the refund/withdrawal exception
- `ICO.reentrancy.ts` — a malicious contract (`contracts/mocks/ReentrancyAttacker.sol`)
  attempting to re-enter `buyTokensPublic`/`claimRefund`
- `ICO.ownable2step.ts` — two-step ownership transfer

## Run it locally

Terminal 1 — start a local node:
```bash
npx hardhat node
```

Terminal 2 — deploy `Token` + `ICO` to it:
```bash
npx hardhat ignition deploy ignition/modules/ICO.ts --network localhost
```

This deploys the `Token`, deploys the `ICO` with a 3-tier default pricing curve (hard
cap 500,000 tokens), and transfers that hard-cap amount from the token to the ICO —
nothing to configure manually for a quick spin-up. By default the presale opens
immediately but with an all-zero Merkle root, meaning **nobody is whitelisted yet** —
you need to set a real root before anyone can buy in the presale (see below). The
public sale opens 2 days after deploy and runs for another 7.

Override any parameter (prices, tiers, caps, dates, cliff/vesting durations, initial
Merkle root) with an Ignition `--parameters` JSON file, e.g.:

```bash
npx hardhat ignition deploy ignition/modules/ICO.ts --network localhost --parameters my-params.json
```

### Generating a presale whitelist / Merkle root

```bash
npm run merkle -- addresses.json
```

where `addresses.json` is a JSON array of whitelisted addresses, e.g.:
```json
["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]
```

This prints the Merkle root (pass it as the `merkleRoot` Ignition parameter, or via
`updateMerkleRoot()` if the ICO is already deployed) and a per-address proof (pass the
matching proof as the argument to `buyTokensPresale`). `scripts/merkle.ts` exports
`buildTree`/`getProof` directly if you'd rather script this than use the CLI —
`test/helpers/merkle.ts` re-exports the same functions so tests and deploy tooling can
never generate mismatched proofs.

## Structure

```
contracts/
  Token.sol                       # OpenZeppelin ERC-20, sold by the ICO
  ICO.sol                         # the ICO itself
  libraries/TieredPricing.sol     # pure tier-lookup / partial-fill pricing math
  mocks/ReentrancyAttacker.sol    # test-only reentrancy attacker
ignition/modules/
  ICO.ts
scripts/
  merkle.ts                       # Merkle whitelist tree/proof builder (CLI + library)
test/
  ICO.ts, ICO.presale.ts, ICO.tiers.ts, ICO.caps.ts, ICO.vesting.ts,
  ICO.pausable.ts, ICO.reentrancy.ts, ICO.ownable2step.ts
  helpers/fixture.ts              # shared deploy fixture used by every test file
  helpers/merkle.ts               # re-exports scripts/merkle.ts for test use
```

## Sale lifecycle

```
Pending  →  Presale (whitelist only)  →  Public  →  Ended  →  finalize()
                                                                   │
                                              ┌────────────────────┴────────────────────┐
                                       soft cap met                              soft cap missed
                                              │                                          │
                              buyers claimVestedTokens()                   buyers claimRefund() (full ETH back)
                              owner withdraw() the ETH raised               owner withdrawUnsoldTokens() (entire balance,
                              owner withdrawUnsoldTokens() (unsold only)     since no buyer ever received tokens)
```

`finalize()` is callable by anyone once the sale ends — not just the owner — so an
uncooperative owner can never block buyers from claiming refunds by withholding it.
