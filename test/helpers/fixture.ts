import { network } from "hardhat";
import { buildTree } from "./merkle.js";

export const DAY = 24 * 3600;

export interface DeployOverrides {
  tierThresholds?: bigint[];
  tierPrices?: bigint[];
  softCapWei?: bigint;
  startDate?: number;
  publicSaleStart?: number;
  endDate?: number;
  cliffDuration?: number;
  vestingDuration?: number;
  whitelist?: string[];
  merkleRoot?: string;
  fundIco?: boolean;
}

/**
 * Deploys Token + ICO with sane, overridable defaults for a 3-tier sale:
 * 200k @ 0.001 ETH, +150k @ 0.0015 ETH, +150k @ 0.002 ETH (hard cap 500k tokens).
 * Presale runs for 1h, public sale for another 1h after that. Whitelist defaults
 * to `presaleBuyer` only.
 */
export async function deployFixture(overrides: DeployOverrides = {}) {
  const { ethers, networkHelpers } = await network.create();
  const [owner, presaleBuyer, publicBuyer, other] = await ethers.getSigners();

  const now = await networkHelpers.time.latest();

  const tierThresholds = overrides.tierThresholds ?? [
    ethers.parseEther("200000"),
    ethers.parseEther("350000"),
    ethers.parseEther("500000"),
  ];
  const tierPrices = overrides.tierPrices ?? [
    ethers.parseEther("0.001"),
    ethers.parseEther("0.0015"),
    ethers.parseEther("0.002"),
  ];
  const softCapWei = overrides.softCapWei ?? ethers.parseEther("50");
  const startDate = overrides.startDate ?? now + 60;
  const publicSaleStart = overrides.publicSaleStart ?? startDate + 3600;
  const endDate = overrides.endDate ?? publicSaleStart + 3600;
  const cliffDuration = overrides.cliffDuration ?? 30 * DAY;
  const vestingDuration = overrides.vestingDuration ?? 150 * DAY;

  const whitelist = overrides.whitelist ?? [presaleBuyer.address];
  const { root, tree } = buildTree(whitelist);
  const merkleRoot = overrides.merkleRoot ?? root;

  const Token = await ethers.getContractFactory("Token");
  const token = await Token.deploy("Training Token", "TRN", ethers.parseEther("1000000"));

  const ICO = await ethers.getContractFactory("ICO");
  const ico = await ICO.deploy(
    await token.getAddress(),
    tierThresholds,
    tierPrices,
    softCapWei,
    startDate,
    publicSaleStart,
    endDate,
    merkleRoot,
    cliffDuration,
    vestingDuration,
  );

  const hardCap = tierThresholds[tierThresholds.length - 1];

  if (overrides.fundIco !== false) {
    await token.transfer(await ico.getAddress(), hardCap);
  }

  return {
    ethers,
    networkHelpers,
    ico,
    token,
    owner,
    presaleBuyer,
    publicBuyer,
    other,
    tierThresholds,
    tierPrices,
    softCapWei,
    startDate,
    publicSaleStart,
    endDate,
    cliffDuration,
    vestingDuration,
    merkleRoot,
    whitelist,
    tree,
    hardCap,
  };
}
