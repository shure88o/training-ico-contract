import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAddress } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export type WhitelistTree = StandardMerkleTree<[string]>;

/**
 * Builds the presale whitelist Merkle tree. Leaf encoding matches ICO.sol's
 * `keccak256(bytes.concat(keccak256(abi.encode(msg.sender))))` via the
 * OZ StandardMerkleTree's ["address"] leaf type — this is the single source
 * of truth reused by deploy tooling and tests so leaf encoding never drifts.
 */
export function buildTree(addresses: string[]): { root: string; tree: WhitelistTree } {
  const values: [string][] = addresses.map((address) => [getAddress(address)]);
  const tree = StandardMerkleTree.of(values, ["address"]);
  return { root: tree.root, tree };
}

/** Proof for `address` against a tree built by `buildTree`. Throws if not whitelisted. */
export function getProof(tree: WhitelistTree, address: string): string[] {
  return tree.getProof([getAddress(address)]);
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run merkle -- <addresses.json>");
    console.error('  addresses.json: JSON array of addresses, e.g. ["0xabc...", "0xdef..."]');
    process.exitCode = 1;
    return;
  }

  const addresses = JSON.parse(readFileSync(path, "utf8")) as string[];
  const { root, tree } = buildTree(addresses);

  console.log("Merkle root:", root);
  console.log("\nProofs:");
  for (const address of addresses) {
    console.log(`  ${getAddress(address)}: ${JSON.stringify(getProof(tree, address))}`);
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main();
}
