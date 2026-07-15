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
npx hardhat ignition deploy ignition/modules/ICODemo.ts --network localhost
```

`ICODemo` deploys a test token and sends part of the supply to the ICO automatically — nothing to configure manually.

## Structure

```
contracts/
  ICO.sol                 # the ICO itself
  interfaces/IERC20.sol
  mocks/MockERC20.sol     # test-only token
ignition/modules/
  ICO.ts                  # production module, takes an existing token address
  ICODemo.ts              # local demo module, deploys its own token
test/
  ICO.ts
```
