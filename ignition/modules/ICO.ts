import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ZERO_HASH = "0x" + "0".repeat(64);
const DAY = 24 * 3600;

export default buildModule("ICOModule", (m) => {
  const tokenName = m.getParameter("tokenName", "Training Token");
  const tokenSymbol = m.getParameter("tokenSymbol", "TRN");
  const initialSupply = m.getParameter("initialSupply", 1_000_000n * 10n ** 18n);

  // Tier thresholds are cumulative tokens sold; the last entry is the hard cap.
  const tierThresholds = m.getParameter("tierThresholds", [
    200_000n * 10n ** 18n,
    350_000n * 10n ** 18n,
    500_000n * 10n ** 18n,
  ]);
  const tierPrices = m.getParameter("tierPrices", [
    10n ** 15n, // 0.001 ETH/token
    (10n ** 15n * 3n) / 2n, // 0.0015 ETH/token
    2n * 10n ** 15n, // 0.002 ETH/token
  ]);

  // icoAllocation must cover the hard cap (last tier threshold).
  const icoAllocation = m.getParameter("icoAllocation", 500_000n * 10n ** 18n);

  const softCapWei = m.getParameter("softCapWei", 50n * 10n ** 18n);

  const startDate = m.getParameter("startDate", Math.floor(Date.now() / 1000));
  const publicSaleStart = m.getParameter("publicSaleStart", Math.floor(Date.now() / 1000) + 2 * DAY);
  const endDate = m.getParameter("endDate", Math.floor(Date.now() / 1000) + 9 * DAY);

  // Zero root means nobody is whitelisted yet — set a real root via updateMerkleRoot()
  // before the presale opens. See scripts/merkle.ts for generating one.
  const merkleRoot = m.getParameter("merkleRoot", ZERO_HASH);

  const cliffDuration = m.getParameter("cliffDuration", 30 * DAY);
  const vestingDuration = m.getParameter("vestingDuration", 150 * DAY);

  const token = m.contract("Token", [tokenName, tokenSymbol, initialSupply]);

  const ico = m.contract("ICO", [
    token,
    tierThresholds,
    tierPrices,
    softCapWei,
    startDate,
    publicSaleStart,
    endDate,
    merkleRoot,
    cliffDuration,
    vestingDuration,
  ]);

  m.call(token, "transfer", [ico, icoAllocation]);

  return { token, ico };
});
