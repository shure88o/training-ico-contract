import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";

describe("ICO — constructor & phases", function () {
  it("sets the constructor params", async function () {
    const {
      ico,
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
      hardCap,
    } = await deployFixture();

    expect(await ico.token()).to.equal(await token.getAddress());
    expect(await ico.getTierThresholds()).to.deep.equal(tierThresholds);
    expect(await ico.getTierPrices()).to.deep.equal(tierPrices);
    expect(await ico.softCapWei()).to.equal(softCapWei);
    expect(await ico.startDate()).to.equal(startDate);
    expect(await ico.publicSaleStart()).to.equal(publicSaleStart);
    expect(await ico.endDate()).to.equal(endDate);
    expect(await ico.merkleRoot()).to.equal(merkleRoot);
    expect(await ico.cliffDuration()).to.equal(cliffDuration);
    expect(await ico.vestingDuration()).to.equal(vestingDuration);
    expect(await ico.hardCapTokens()).to.equal(hardCap);
    expect(await ico.owner()).to.not.equal(await ico.getAddress());
  });

  it("rejects a zero token address", async function () {
    const { ethers, tierThresholds, tierPrices, softCapWei, startDate, publicSaleStart, endDate, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        ethers.ZeroAddress,
        tierThresholds,
        tierPrices,
        softCapWei,
        startDate,
        publicSaleStart,
        endDate,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "ZeroAddress");
  });

  it("rejects startDate >= publicSaleStart", async function () {
    const { ethers, token, tierThresholds, tierPrices, softCapWei, startDate, endDate, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        await token.getAddress(),
        tierThresholds,
        tierPrices,
        softCapWei,
        startDate,
        startDate,
        endDate,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "InvalidDates");
  });

  it("rejects publicSaleStart >= endDate", async function () {
    const { ethers, token, tierThresholds, tierPrices, softCapWei, startDate, publicSaleStart, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        await token.getAddress(),
        tierThresholds,
        tierPrices,
        softCapWei,
        startDate,
        publicSaleStart,
        publicSaleStart,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "InvalidDates");
  });

  it("rejects mismatched tier array lengths", async function () {
    const { ethers, token, tierPrices, softCapWei, startDate, publicSaleStart, endDate, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        await token.getAddress(),
        [ethers.parseEther("100000")],
        tierPrices,
        softCapWei,
        startDate,
        publicSaleStart,
        endDate,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "InvalidTierConfig");
  });

  it("rejects non-ascending tier thresholds", async function () {
    const { ethers, token, tierPrices, softCapWei, startDate, publicSaleStart, endDate, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        await token.getAddress(),
        [ethers.parseEther("200000"), ethers.parseEther("100000"), ethers.parseEther("500000")],
        tierPrices,
        softCapWei,
        startDate,
        publicSaleStart,
        endDate,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "InvalidTierConfig");
  });

  it("rejects non-ascending tier prices", async function () {
    const { ethers, token, tierThresholds, softCapWei, startDate, publicSaleStart, endDate, merkleRoot, cliffDuration, vestingDuration } =
      await deployFixture({ fundIco: false });

    const ICO = await ethers.getContractFactory("ICO");
    await expect(
      ICO.deploy(
        await token.getAddress(),
        tierThresholds,
        [ethers.parseEther("0.002"), ethers.parseEther("0.0015"), ethers.parseEther("0.003")],
        softCapWei,
        startDate,
        publicSaleStart,
        endDate,
        merkleRoot,
        cliffDuration,
        vestingDuration,
      ),
    ).to.be.revertedWithCustomError(ICO, "InvalidTierConfig");
  });

  it("walks through Pending -> Presale -> Public -> Ended -> Finalized", async function () {
    const { ico, startDate, publicSaleStart, endDate, networkHelpers } = await deployFixture();

    expect(await ico.phase()).to.equal(0n); // Pending

    await networkHelpers.time.increaseTo(startDate);
    expect(await ico.phase()).to.equal(1n); // Presale

    await networkHelpers.time.increaseTo(publicSaleStart);
    expect(await ico.phase()).to.equal(2n); // Public

    await networkHelpers.time.increaseTo(endDate + 1);
    expect(await ico.phase()).to.equal(3n); // Ended

    await ico.finalize();
    expect(await ico.phase()).to.equal(4n); // Finalized
  });
});
