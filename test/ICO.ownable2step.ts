import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";

describe("ICO — Ownable2Step", function () {
  it("rejects transferOwnership from a non-owner", async function () {
    const { ico, other, presaleBuyer } = await deployFixture();
    await expect(
      ico.connect(other).transferOwnership(presaleBuyer.address),
    ).to.be.revertedWithCustomError(ico, "OwnableUnauthorizedAccount");
  });

  it("does not change the owner until the pending owner accepts", async function () {
    const { ico, owner, other, ethers } = await deployFixture();

    await ico.connect(owner).transferOwnership(other.address);

    expect(await ico.owner()).to.equal(owner.address);
    expect(await ico.pendingOwner()).to.equal(other.address);

    // old owner still holds onlyOwner privileges in the meantime
    await expect(ico.connect(owner).pause()).to.not.revert(ethers);
    await expect(ico.connect(other).pause()).to.be.revertedWithCustomError(ico, "OwnableUnauthorizedAccount");
  });

  it("transfers ownership once the pending owner calls acceptOwnership", async function () {
    const { ico, owner, other, ethers } = await deployFixture();

    await ico.connect(owner).transferOwnership(other.address);
    await ico.connect(other).acceptOwnership();

    expect(await ico.owner()).to.equal(other.address);
    expect(await ico.pendingOwner()).to.equal(ethers.ZeroAddress);

    await expect(ico.connect(owner).pause()).to.be.revertedWithCustomError(ico, "OwnableUnauthorizedAccount");
    await expect(ico.connect(other).pause()).to.not.revert(ethers);
  });

  it("rejects acceptOwnership from anyone other than the pending owner", async function () {
    const { ico, owner, other, presaleBuyer } = await deployFixture();

    await ico.connect(owner).transferOwnership(other.address);
    await expect(ico.connect(presaleBuyer).acceptOwnership()).to.be.revertedWithCustomError(
      ico,
      "OwnableUnauthorizedAccount",
    );
  });

  it("lets a second transferOwnership call overwrite a pending one", async function () {
    const { ico, owner, other, presaleBuyer } = await deployFixture();

    await ico.connect(owner).transferOwnership(other.address);
    await ico.connect(owner).transferOwnership(presaleBuyer.address);

    expect(await ico.pendingOwner()).to.equal(presaleBuyer.address);
    await expect(ico.connect(other).acceptOwnership()).to.be.revertedWithCustomError(
      ico,
      "OwnableUnauthorizedAccount",
    );

    await ico.connect(presaleBuyer).acceptOwnership();
    expect(await ico.owner()).to.equal(presaleBuyer.address);
  });
});
