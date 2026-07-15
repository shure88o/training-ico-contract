# ICO Training Contract

Simple ICO contract with a fixed token price. Sales are only open within a date range that's set on deploy. Built with Hardhat 3 + Ignition.

## Setup

```bash
npm install
npx hardhat compile
```

## Test

```bash
npx hardhat test
```

## Deploy locally

Terminal 1:
```bash
npx hardhat node
```

Terminal 2:
```bash
npx hardhat ignition deploy ignition/modules/ICO.ts --network localhost
```

The module deploys the `Token`, deploys the `ICO`, and sends part of the token supply to the ICO — nothing to configure manually. Override defaults (name, symbol, supply, price, dates) with a `--parameters` file if needed.

## Structure

```
contracts/
  Token.sol              # OpenZeppelin ERC-20, sold by the ICO
  ICO.sol                # the ICO itself
  interfaces/IERC20.sol
ignition/modules/
  ICO.ts
test/
  ICO.ts
```
