export function decisionClosesGate(decision) {
  return ["approved", "rejected", "resolved"].includes(decision?.status);
}

export function shouldAdvanceReviewSelection(status) {
  return decisionClosesGate({ status });
}
