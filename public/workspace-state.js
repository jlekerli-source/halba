export { decisionClosesGate } from "./shared/review-contract.js";

import { decisionClosesGate } from "./shared/review-contract.js";

export function shouldAdvanceReviewSelection(status) {
  return decisionClosesGate({ status });
}
