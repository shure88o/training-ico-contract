import { expect } from "chai";
import { network } from "hardhat";

describe("ICO", function () {
  async function deployFixture() {
    const { ethers, networkHelpers } = await network.create();
    const [owner, buyer] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy("Training Token", "TRN", ethers.parseEther("1000000"));

    const now = await networkHelpers.time.latest();
    const startDate = now + 60;
    const endDate = now + 3600;
    const pricePerToken = ethers.parseEther("0.001");
    const icoAllocation = ethers.parseEther("500000");

    const ICO = await ethers.getContractFactory("ICO");
    const ico = await ICO.deploy(
      await token.getAddress(),
      pricePerToken,
      startDate,
      endDate,
    );

    await token.transfer(await ico.getAddress(), icoAllocation);

    return {
      ico,
      token,
      owner,
      buyer,
      startDate,
      endDate,
      pricePerToken,
      icoAllocation,
      networkHelpers,
      ethers,
    };
  }

  it("sets the constructor params", async function () {
    const { ico, token, startDate, endDate, pricePerToken } = await deployFixture();

    expect(await ico.token()).to.equal(await token.getAddress());
    expect(await ico.startDate()).to.equal(startDate);
    expect(await ico.endDate()).to.equal(endDate);
    expect(await ico.pricePerToken()).to.equal(pricePerToken);
  });

  it("rejects buyTokens before the start date", async function () {
    const { ico, buyer, ethers } = await deployFixture();

    await expect(
      ico.connect(buyer).buyTokens({ value: ethers.parseEther("1") }),
    ).to.be.revertedWith("ICO is not open");
  });

  it("sells tokens at the fixed price during the date range", async function () {
    const { ico, token, buyer, startDate, pricePerToken, networkHelpers, ethers } =
      await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    const payment = ethers.parseEther("1");
    await ico.connect(buyer).buyTokens({ value: payment });

    const expectedTokens = (payment * 10n ** 18n) / pricePerToken;
    expect(await token.balanceOf(buyer.address)).to.equal(expectedTokens);
  });

  it("rejects buyTokens after the end date", async function () {
    const { ico, buyer, endDate, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(endDate + 1);

    await expect(
      ico.connect(buyer).buyTokens({ value: ethers.parseEther("1") }),
    ).to.be.revertedWith("ICO is not open");
  });

  it("rejects buyTokens when not enough tokens are left for sale", async function () {
    const { ico, buyer, startDate, icoAllocation, pricePerToken, networkHelpers, ethers } =
      await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    const tooMuch = ((icoAllocation + ethers.parseEther("1")) * pricePerToken) / 10n ** 18n;

    await expect(
      ico.connect(buyer).buyTokens({ value: tooMuch }),
    ).to.be.revertedWith("not enough tokens left");
  });

  it("lets only the owner withdraw the collected ETH, and only after the ICO ends", async function () {
    const { ico, owner, buyer, startDate, endDate, networkHelpers, ethers } =
      await deployFixture();

    await networkHelpers.time.increaseTo(startDate);
    await ico.connect(buyer).buyTokens({ value: ethers.parseEther("1") });

    await expect(ico.connect(owner).withdraw()).to.be.revertedWith("ICO still running");
    await expect(ico.connect(buyer).withdraw()).to.be.revertedWith("not owner");

    await networkHelpers.time.increaseTo(endDate + 1);

    const balanceBefore = await ethers.provider.getBalance(owner.address);
    const tx = await ico.connect(owner).withdraw();
    const receipt = await tx.wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

    const balanceAfter = await ethers.provider.getBalance(owner.address);
    expect(balanceAfter).to.equal(balanceBefore + ethers.parseEther("1") - gasUsed);
  });

  it("lets the owner reclaim unsold tokens only after the end date", async function () {
    const { ico, token, owner, endDate, networkHelpers, ethers } = await deployFixture();

    await expect(
      ico.connect(owner).withdrawUnsoldTokens(ethers.parseEther("1")),
    ).to.be.revertedWith("ICO still running");

    await networkHelpers.time.increaseTo(endDate + 1);

    const icoBalance = await token.balanceOf(await ico.getAddress());
    const ownerBalanceBefore = await token.balanceOf(owner.address);
    await ico.connect(owner).withdrawUnsoldTokens(icoBalance);

    expect(await token.balanceOf(owner.address)).to.equal(ownerBalanceBefore + icoBalance);
  });
});
