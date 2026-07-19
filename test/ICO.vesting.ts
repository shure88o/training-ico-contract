import { expect } from "chai";
import { deployFixture, type DeployOverrides } from "./helpers/fixture.js";

// Single tier so a single purchase buys the entire hard cap — clean numbers.
const SINGLE_TIER_OVERRIDES = {
  tierThresholds: [1_000n * 10n ** 18n],
  tierPrices: [10n ** 15n], // 0.001 ETH/token
};

async function deployAndBuy(overrides: DeployOverrides = {}) {
  const fixture = await deployFixture({
    ...SINGLE_TIER_OVERRIDES,
    softCapWei: 0n, // trivially met so vesting/claims are reachable
    cliffDuration: 100,
    vestingDuration: 1000,
    ...overrides,
  });

  const { ico, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = fixture;
  await networkHelpers.time.increaseTo(publicSaleStart);
  await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") }); // buys the full 1,000 tokens

  await networkHelpers.time.increaseTo(endDate + 1);
  await ico.finalize();

  return fixture;
}

describe("ICO — vesting", function () {
  it("vests nothing before the cliff ends, and claim reverts", async function () {
    const { ico, publicBuyer, endDate, cliffDuration, networkHelpers } = await deployAndBuy();

    await networkHelpers.time.increaseTo(endDate + cliffDuration - 1);
    expect(await ico.claimableTokens(publicBuyer.address)).to.equal(0n);
    await expect(ico.connect(publicBuyer).claimVestedTokens()).to.be.revertedWithCustomError(
      ico,
      "NothingToClaim",
    );
  });

  it("vests nothing exactly at the cliff boundary (unlock starts the instant after)", async function () {
    const { ico, publicBuyer, endDate, cliffDuration, networkHelpers } = await deployAndBuy();

    await networkHelpers.time.increaseTo(endDate + cliffDuration);
    expect(await ico.claimableTokens(publicBuyer.address)).to.equal(0n);
  });

  it("vests linearly between the cliff and the end of the vesting duration", async function () {
    const { ico, publicBuyer, endDate, cliffDuration, vestingDuration, networkHelpers, ethers } =
      await deployAndBuy();

    const cliffEnd = endDate + cliffDuration;
    await networkHelpers.time.increaseTo(cliffEnd + 250); // 25% through vesting

    const allocated = ethers.parseEther("1000");
    const expected = (allocated * 250n) / BigInt(vestingDuration);
    expect(await ico.claimableTokens(publicBuyer.address)).to.equal(expected);
  });

  it("sums multiple partial claims to exactly the full allocation, no dust", async function () {
    const { ico, token, publicBuyer, endDate, cliffDuration, vestingDuration, networkHelpers, ethers } =
      await deployAndBuy();

    const cliffEnd = endDate + cliffDuration;
    const allocated = ethers.parseEther("1000");

    await networkHelpers.time.increaseTo(cliffEnd + 250);
    await ico.connect(publicBuyer).claimVestedTokens();

    await networkHelpers.time.increaseTo(cliffEnd + 600);
    await ico.connect(publicBuyer).claimVestedTokens();

    await networkHelpers.time.increaseTo(cliffEnd + vestingDuration + 1);
    await ico.connect(publicBuyer).claimVestedTokens();

    expect((await ico.purchases(publicBuyer.address)).tokensClaimed).to.equal(allocated);
    expect(await token.balanceOf(publicBuyer.address)).to.equal(allocated);
    await expect(ico.connect(publicBuyer).claimVestedTokens()).to.be.revertedWithCustomError(
      ico,
      "NothingToClaim",
    );
  });

  it("fully unlocks at the cliff when vestingDuration is zero", async function () {
    const { ico, token, publicBuyer, endDate, cliffDuration, networkHelpers, ethers } = await deployAndBuy({
      vestingDuration: 0,
    });

    const cliffEnd = endDate + cliffDuration;
    const allocated = ethers.parseEther("1000");

    await networkHelpers.time.increaseTo(cliffEnd - 1);
    expect(await ico.claimableTokens(publicBuyer.address)).to.equal(0n); // still before cliff

    await networkHelpers.time.increaseTo(cliffEnd);
    expect(await ico.claimableTokens(publicBuyer.address)).to.equal(allocated);

    await ico.connect(publicBuyer).claimVestedTokens();
    expect(await token.balanceOf(publicBuyer.address)).to.equal(allocated);
  });
});
