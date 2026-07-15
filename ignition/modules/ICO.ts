import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ICOModule", (m) => {
  const tokenName = m.getParameter("tokenName", "Training Token");
  const tokenSymbol = m.getParameter("tokenSymbol", "TRN");
  const initialSupply = m.getParameter("initialSupply", 1_000_000n * 10n ** 18n);
  const icoAllocation = m.getParameter("icoAllocation", 500_000n * 10n ** 18n);
  const pricePerToken = m.getParameter("pricePerToken", 10n ** 15n);
  const startDate = m.getParameter("startDate", Math.floor(Date.now() / 1000));
  const endDate = m.getParameter("endDate", Math.floor(Date.now() / 1000) + 7 * 24 * 3600);

  const token = m.contract("Token", [tokenName, tokenSymbol, initialSupply]);

  const ico = m.contract("ICO", [token, pricePerToken, startDate, endDate]);

  m.call(token, "transfer", [ico, icoAllocation]);

  return { token, ico };
});
