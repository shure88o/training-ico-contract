import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";

describe("ICO — finalize / soft cap / refunds", function () {
  it("rejects finalize before the sale ends", async function () {
    const { ico } = await deployFixture();
    await expect(ico.finalize()).to.be.revertedWithCustomError(ico, "SaleStillRunning");
  });

  it("lets anyone (not just the owner) finalize once the sale ends", async function () {
    const { ico, other, endDate, networkHelpers } = await deployFixture();
    await networkHelpers.time.increaseTo(endDate + 1);

    await expect(ico.connect(other).finalize()).to.emit(ico, "Finalized").withArgs(false, 0n);
    expect(await ico.finalized()).to.equal(true);
  });

  it("rejects a second finalize call", async function () {
    const { ico, endDate, networkHelpers } = await deployFixture();
    await networkHelpers.time.increaseTo(endDate + 1);

    await ico.finalize();
    await expect(ico.finalize()).to.be.revertedWithCustomError(ico, "AlreadyFinalized");
  });

  describe("soft cap missed", function () {
    it("marks the sale as failed and lets buyers claim a full refund", async function () {
      // Default soft cap is 50 ETH; this purchase stays well under it.
      const { ico, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture();

      await networkHelpers.time.increaseTo(publicSaleStart);
      const payment = ethers.parseEther("1");
      await ico.connect(publicBuyer).buyTokensPublic({ value: payment });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();
      expect(await ico.softCapReached()).to.equal(false);

      const tx = ico.connect(publicBuyer).claimRefund();
      await expect(tx).to.emit(ico, "RefundClaimed").withArgs(publicBuyer.address, payment);
      await expect(tx).to.changeEtherBalance(ethers, publicBuyer, payment);
    });

    it("rejects a second refund claim", async function () {
      const { ico, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture();

      await networkHelpers.time.increaseTo(publicSaleStart);
      await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await ico.connect(publicBuyer).claimRefund();
      await expect(ico.connect(publicBuyer).claimRefund()).to.be.revertedWithCustomError(ico, "AlreadyRefunded");
    });

    it("rejects a refund claim from someone who never bought", async function () {
      const { ico, other, endDate, networkHelpers } = await deployFixture();
      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await expect(ico.connect(other).claimRefund()).to.be.revertedWithCustomError(ico, "NothingToRefund");
    });

    it("permanently blocks vesting claims, even after the cliff", async function () {
      const { ico, publicBuyer, publicSaleStart, endDate, cliffDuration, networkHelpers, ethers } =
        await deployFixture();

      await networkHelpers.time.increaseTo(publicSaleStart);
      await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await networkHelpers.time.increaseTo(endDate + cliffDuration + 1);
      await expect(ico.connect(publicBuyer).claimVestedTokens()).to.be.revertedWithCustomError(
        ico,
        "SoftCapNotMet",
      );
    });
  });

  describe("soft cap met", function () {
    it("rejects owner withdraw before finalize", async function () {
      const { ico, owner } = await deployFixture();
      await expect(ico.connect(owner).withdraw()).to.be.revertedWithCustomError(ico, "NotFinalized");
    });

    it("rejects owner withdraw when the soft cap was missed", async function () {
      const { ico, owner, endDate, networkHelpers } = await deployFixture();
      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await expect(ico.connect(owner).withdraw()).to.be.revertedWithCustomError(ico, "SoftCapNotMet");
    });

    it("lets the owner withdraw the raised ETH once the sale succeeds", async function () {
      const { ico, owner, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture({
        softCapWei: 5n * 10n ** 17n, // 0.5 ETH
      });

      await networkHelpers.time.increaseTo(publicSaleStart);
      const payment = ethers.parseEther("1");
      await ico.connect(publicBuyer).buyTokensPublic({ value: payment });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();
      expect(await ico.softCapReached()).to.equal(true);

      const tx = ico.connect(owner).withdraw();
      await expect(tx).to.emit(ico, "Withdrawn").withArgs(payment);
      await expect(tx).to.changeEtherBalance(ethers, owner, payment);
    });

    it("rejects refund claims once the soft cap was met", async function () {
      const { ico, publicBuyer, publicSaleStart, endDate, networkHelpers, ethers } = await deployFixture({
        softCapWei: 5n * 10n ** 17n, // 0.5 ETH
      });

      await networkHelpers.time.increaseTo(publicSaleStart);
      await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await expect(ico.connect(publicBuyer).claimRefund()).to.be.revertedWithCustomError(ico, "SoftCapMet");
    });
  });

  describe("withdrawUnsoldTokens", function () {
    it("rejects before finalize", async function () {
      const { ico, owner } = await deployFixture();
      await expect(ico.connect(owner).withdrawUnsoldTokens()).to.be.revertedWithCustomError(ico, "NotFinalized");
    });

    it("lets the owner reclaim the full balance if the soft cap was missed", async function () {
      const { ico, token, owner, publicBuyer, publicSaleStart, endDate, hardCap, networkHelpers, ethers } =
        await deployFixture();

      await networkHelpers.time.increaseTo(publicSaleStart);
      await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") });

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      await expect(ico.connect(owner).withdrawUnsoldTokens())
        .to.emit(ico, "UnsoldTokensWithdrawn")
        .withArgs(hardCap);
      expect(await token.balanceOf(await ico.getAddress())).to.equal(0n);
    });

    it("reclaims only the unsold portion if the soft cap was met", async function () {
      const { ico, token, owner, publicBuyer, publicSaleStart, endDate, hardCap, networkHelpers, ethers } =
        await deployFixture({ softCapWei: 5n * 10n ** 17n }); // 0.5 ETH

      await networkHelpers.time.increaseTo(publicSaleStart);
      await ico.connect(publicBuyer).buyTokensPublic({ value: ethers.parseEther("1") }); // buys 1000 tokens

      await networkHelpers.time.increaseTo(endDate + 1);
      await ico.finalize();

      const sold = (await ico.purchases(publicBuyer.address)).tokensAllocated;
      const expectedUnsold = hardCap - sold; // nothing claimed yet

      await expect(ico.connect(owner).withdrawUnsoldTokens())
        .to.emit(ico, "UnsoldTokensWithdrawn")
        .withArgs(expectedUnsold);
      expect(await token.balanceOf(await ico.getAddress())).to.equal(sold);
    });
  });
});
