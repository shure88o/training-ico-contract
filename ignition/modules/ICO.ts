import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ICOModule", (m) => {
  const token = m.getParameter("token");
  const pricePerToken = m.getParameter("pricePerToken");
  const startDate = m.getParameter("startDate");
  const endDate = m.getParameter("endDate");

  const ico = m.contract("ICO", [token, pricePerToken, startDate, endDate]);

  return { ico };
});
