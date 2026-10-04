import { registerApprovalHandler } from "../approvals/service";
import { discountApprovalHandler, refundApprovalHandler, reversalApprovalHandler } from "./adjustments";
import { feeStructureApprovalHandler } from "./structures";

export { registerFees } from "./routes";

/** The fees kinds of approval (D-075), registered from the composition root like `content`'s (D-061). */
export function registerFeesApprovalHandlers(): void {
  registerApprovalHandler("fee_structure", feeStructureApprovalHandler);
  registerApprovalHandler("discount", discountApprovalHandler);
  registerApprovalHandler("reversal", reversalApprovalHandler);
  registerApprovalHandler("refund", refundApprovalHandler);
}
export { feesDashboardPart, type FeesDashboard } from "./dues";
export { carryDues, enrollmentBalances, type CarryResult } from "./carry";
