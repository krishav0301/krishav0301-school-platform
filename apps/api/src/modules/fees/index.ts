import { registerApprovalHandler } from "../approvals/service";
import { discountApprovalHandler, refundApprovalHandler, reversalApprovalHandler } from "./adjustments";
import { feeEditApprovalHandler, feeStructureApprovalHandler } from "./structures";

export { registerFees } from "./routes";

/** The fees kinds of approval (D-075), registered from the composition root like `content`'s (D-061). */
export function registerFeesApprovalHandlers(): void {
  registerApprovalHandler("fee_structure", feeStructureApprovalHandler);
  registerApprovalHandler("fee_structure_edit", feeEditApprovalHandler);
  registerApprovalHandler("discount", discountApprovalHandler);
  registerApprovalHandler("reversal", reversalApprovalHandler);
  registerApprovalHandler("refund", refundApprovalHandler);
}
export { feesDashboardPart, type FeesDashboard } from "./dues";
export { applyPriceChanges, chargeLinked } from "./structures";
export { carryDues, enrollmentBalances, type CarryResult } from "./carry";
