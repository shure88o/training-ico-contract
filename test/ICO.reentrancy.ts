import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";

const TWO_TIER_OVERRIDES = {
  tierThresholds: [1_000n * 10n ** 18n, 2_000n * 10n ** 18n],
  tierPrices: [10n ** 15n, 2n * 10n ** 15n],
};

describe("ICO — reentrancy protection", function () {
  it("blocks a reentrant buyTokensPublic call triggered from the change refund", async function () {
    const { ico, publicSaleStart, networkHelpers, ethers } = await deployFixture(TWO_TIER_OVERRIDES);
    await networkHelpers.time.increaseTo(publicSaleStart);

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(await ico.getAddress());

    // Sending 1.5 ETH crosses the tier-1 boundary, producing a 0.5 ETH change
    // refund mid-transaction — exactly the moment the attacker's receive() fires
    // and tries to call buyTokensPublic() again.
    await expect(attacker.attackBuy({ value: ethers.parseEther("1.5") })).to.be.revertedWithCustomError(
      ico,
      "ChangeTransferFailed",
    );

    expect(await ico.totalTokensSold()).to.equal(0n); // the whole attack reverted, nothing sold
  });

  it("blocks a reentrant claimRefund call", async function () {
    const { ico, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture();

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(await ico.getAddress());

    await networkHelpers.time.increaseTo(publicSaleStart);
    // Exactly 1 ETH divides evenly into whole tokens at the tier-1 price, so this
    // buy produces zero change and doesn't itself trigger the receive() hook.
    await attacker.attackBuy({ value: ethers.parseEther("1") });
    expect((await ico.purchases(await attacker.getAddress())).ethContributed).to.equal(ethers.parseEther("1"));

    await networkHelpers.time.increaseTo(endDate + 1);
    await ico.finalize(); // soft cap missed with the default 50 ETH cap

    await expect(attacker.attackRefund()).to.be.revertedWithCustomError(ico, "RefundTransferFailed");

    // The whole claimRefund() call reverted, so state changes rolled back too.
    expect((await ico.purchases(await attacker.getAddress())).refunded).to.equal(false);
  });
});
