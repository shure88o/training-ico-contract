import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";

// Two clean tiers: 1,000 tokens @ 0.001 ETH, then 1,000 more @ 0.002 ETH (hard cap 2,000).
const TWO_TIER_OVERRIDES = {
  tierThresholds: [1_000n * 10n ** 18n, 2_000n * 10n ** 18n],
  tierPrices: [10n ** 15n, 2n * 10n ** 15n],
};

describe("ICO — tiered pricing", function () {
  it("prices a purchase fully within tier 1 at the tier 1 price, no change", async function () {
    const { ico, token, publicBuyer, publicSaleStart, networkHelpers, ethers } =
      await deployFixture(TWO_TIER_OVERRIDES);

    await networkHelpers.time.increaseTo(publicSaleStart);

    const payment = ethers.parseEther("0.5"); // buys 500 tokens at 0.001 ETH/token
    const tx = ico.connect(publicBuyer).buyTokensPublic({ value: payment });

    await expect(tx)
      .to.emit(ico, "TokensPurchased")
      .withArgs(publicBuyer.address, payment, ethers.parseEther("500"));
    await expect(tx).to.changeEtherBalance(ethers, publicBuyer, -payment);

    expect(await ico.totalTokensSold()).to.equal(ethers.parseEther("500"));
    expect((await ico.purchases(publicBuyer.address)).tokensAllocated).to.equal(ethers.parseEther("500"));
    expect(await token.balanceOf(publicBuyer.address)).to.equal(0n); // vesting, not immediate
  });

  it("partial-fills at the tier boundary and refunds the exact change", async function () {
    const { ico, publicBuyer, publicSaleStart, networkHelpers, ethers } = await deployFixture(TWO_TIER_OVERRIDES);

    await networkHelpers.time.increaseTo(publicSaleStart);

    // 1.5 ETH at 0.001/token would want 1,500 tokens, but only 1,000 remain in tier 1.
    const payment = ethers.parseEther("1.5");
    const expectedCost = ethers.parseEther("1"); // 1,000 tokens @ 0.001 ETH
    const tx = ico.connect(publicBuyer).buyTokensPublic({ value: payment });

    await expect(tx)
      .to.emit(ico, "TokensPurchased")
      .withArgs(publicBuyer.address, expectedCost, ethers.parseEther("1000"));
    await expect(tx).to.changeEtherBalance(ethers, publicBuyer, -expectedCost);

    expect(await ico.totalTokensSold()).to.equal(ethers.parseEther("1000"));
  });

  it("sells the next purchase at the next tier's price", async function () {
    const { ico, publicBuyer, publicSaleStart, networkHelpers, ethers } = await deployFixture(TWO_TIER_OVERRIDES);

    await networkHelpers.time.increaseTo(publicSaleStart);

    await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") }); // exhausts tier 1

    const payment = ethers.parseEther("1"); // 500 tokens @ 0.002 ETH in tier 2
    const tx = ico.connect(publicBuyer).buyTokensPublic({ value: payment });

    await expect(tx)
      .to.emit(ico, "TokensPurchased")
      .withArgs(publicBuyer.address, payment, ethers.parseEther("500"));

    expect(await ico.totalTokensSold()).to.equal(ethers.parseEther("1500"));
  });

  it("sells exactly up to the hard cap with no change, then rejects further purchases", async function () {
    const { ico, publicBuyer, other, publicSaleStart, networkHelpers, ethers } =
      await deployFixture(TWO_TIER_OVERRIDES);

    await networkHelpers.time.increaseTo(publicSaleStart);

    await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") }); // tier 1 done
    await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("2") }); // tier 2 done, exact

    expect(await ico.totalTokensSold()).to.equal(ethers.parseEther("2000"));
    expect(await ico.hardCapTokens()).to.equal(ethers.parseEther("2000"));

    await expect(
      ico.connect(other).buyTokensPublic({ value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "HardCapReached");
  });

  it("rejects a zero-value purchase", async function () {
    const { ico, publicBuyer, publicSaleStart, networkHelpers } = await deployFixture();
    await networkHelpers.time.increaseTo(publicSaleStart);

    await expect(ico.connect(publicBuyer).buyTokensPublic({ value: 0n })).to.be.revertedWithCustomError(
      ico,
      "ZeroPayment",
    );
  });
});
