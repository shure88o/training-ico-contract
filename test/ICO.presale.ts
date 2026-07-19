import { expect } from "chai";
import { deployFixture } from "./helpers/fixture.js";
import { buildTree, getProof } from "./helpers/merkle.js";

describe("ICO — presale whitelist", function () {
  it("lets a whitelisted address buy with a valid proof", async function () {
    const { ico, token, presaleBuyer, startDate, tree, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    const proof = getProof(tree, presaleBuyer.address);
    const payment = ethers.parseEther("1");
    await ico.connect(presaleBuyer).buyTokensPresale(proof, { value: payment });

    const expectedTokens = (payment * 10n ** 18n) / ethers.parseEther("0.001");
    const purchase = await ico.purchases(presaleBuyer.address);
    expect(purchase.tokensAllocated).to.equal(expectedTokens);
    // Tokens are held for vesting, not sent immediately.
    expect(await token.balanceOf(presaleBuyer.address)).to.equal(0n);
  });

  it("rejects a non-whitelisted address", async function () {
    const { ico, other, startDate, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    // `other` isn't in the tree, so there's no real proof for it — an empty
    // proof is the correct thing a non-whitelisted caller would be stuck with.
    await expect(
      ico.connect(other).buyTokensPresale([], { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "NotWhitelisted");
  });

  it("rejects a valid proof used by the wrong address", async function () {
    const { ico, presaleBuyer, other, startDate, tree, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    const proofForPresaleBuyer = getProof(tree, presaleBuyer.address);
    await expect(
      ico.connect(other).buyTokensPresale(proofForPresaleBuyer, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "NotWhitelisted");
  });

  it("rejects buyTokensPresale once the public phase starts, even with a valid proof", async function () {
    const { ico, presaleBuyer, publicSaleStart, tree, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(publicSaleStart);

    const proof = getProof(tree, presaleBuyer.address);
    await expect(
      ico.connect(presaleBuyer).buyTokensPresale(proof, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "WrongPhase");
  });

  it("lets the owner rotate the whitelist mid-presale", async function () {
    const { ico, owner, presaleBuyer, other, startDate, tree, networkHelpers, ethers } = await deployFixture();

    await networkHelpers.time.increaseTo(startDate);

    const { root: newRoot, tree: newTree } = buildTree([other.address]);
    await expect(ico.connect(owner).updateMerkleRoot(newRoot))
      .to.emit(ico, "MerkleRootUpdated")
      .withArgs(await ico.merkleRoot(), newRoot);

    const oldProof = getProof(tree, presaleBuyer.address);
    await expect(
      ico.connect(presaleBuyer).buyTokensPresale(oldProof, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(ico, "NotWhitelisted");

    const newProof = getProof(newTree, other.address);
    await expect(
      ico.connect(other).buyTokensPresale(newProof, { value: ethers.parseEther("1") }),
    ).to.not.revert(ethers);
  });

  it("rejects updateMerkleRoot from a non-owner", async function () {
    const { ico, other } = await deployFixture();

    await expect(ico.connect(other).updateMerkleRoot(ethers_zeroHash())).to.be.revertedWithCustomError(
      ico,
      "OwnableUnauthorizedAccount",
    );
  });

  it("rejects updateMerkleRoot once the public phase has started", async function () {
    const { ico, owner, publicSaleStart, networkHelpers } = await deployFixture();

    await networkHelpers.time.increaseTo(publicSaleStart);

    await expect(ico.connect(owner).updateMerkleRoot(ethers_zeroHash())).to.be.revertedWithCustomError(
      ico,
      "WrongPhase",
    );
  });
});

function ethers_zeroHash(): string {
  return "0x" + "0".repeat(64);
}
