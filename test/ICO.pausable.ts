import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";
import { getProof } from "./helpers/merkle.js";

describe("ICO — pausable", function () {
  it("rejects pause/unpause from a non-owner", async function () {
    const { ico, other } = await deployFixture();
    await expect(ico.connect(other).pause()).to.be.revertedWithCustomError(ico, "OwnableUnauthorizedAccount");
    await expect(ico.connect(other).unpause()).to.be.revertedWithCustomError(ico, "OwnableUnauthorizedAccount");
  });

  it("blocks presale purchases, public purchases, and vesting claims while paused", async function () {
    const {
      ico,
      owner,
      presaleBuyer,
      publicBuyer,
      startDate,
      publicSaleStart,
      endDate,
      tree,
      networkHelpers,
      ethers,
    } = await deployFixture({ softCapWei: 0n });

    await ico.connect(owner).pause();

    await networkHelpers.time.increaseTo(startDate);
    const proof = getProof(tree, presaleBuyer.address);
    await expect(
      ico.connect(presaleBuyer).buyTokensPresale(proof, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "EnforcedPause");

    await networkHelpers.time.increaseTo(publicSaleStart);
    await expect(
      ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "EnforcedPause");

    await networkHelpers.time.increaseTo(endDate + 1);
    await ico.finalize();
    await expect(ico.connect(publicBuyer).claimVestedTokens()).to.be.revertedWithCustomError(
      ico,
      "EnforcedPause",
    );
  });

  it("still allows refund claims while paused (soft cap missed)", async function () {
    const { ico, owner, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(publicSaleStart);
    const payment = ethers.parseEther("1");
    await ico.connect(publicBuyer).buyTokensPublic({ value: payment });

    await networkHelpers.time.increaseTo(endDate + 1);
    await ico.finalize(); // soft cap missed with the default 50 ETH cap

    await ico.connect(owner).pause();

    await expect(ico.connect(publicBuyer).claimRefund()).to.not.revert(ethers);
  });

  it("still allows owner withdrawal while paused (soft cap met)", async function () {
    const { ico, owner, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture({
      softCapWei: 5n * 10n ** 17n, // 0.5 ETH
    });

    await networkHelpers.time.increaseTo(publicSaleStart);
    await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") });

    await networkHelpers.time.increaseTo(endDate + 1);
    await ico.finalize();

    await ico.connect(owner).pause();

    await expect(ico.connect(owner).withdraw()).to.not.revert(ethers);
  });

  it("resumes purchases after unpause", async function () {
    const { ico, owner, publicBuyer, publicSaleStart, networkHelpers, ethers } = await deployFixture();

    await ico.connect(owner).pause();
    await ico.connect(owner).unpause();

    await networkHelpers.time.increaseTo(publicSaleStart);
    await expect(ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") })).to.not.revert(ethers);
  });
});
