export function daysBetween(from, to) {
  return Math.floor((to - from) / 86400000);
}

export function proofDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isStale(project, now = new Date()) {
  const lastProof = proofDate(project.lastProofDate);
  const windowDays = Number(project.proofWindowDays);
  if (!lastProof || !Number.isFinite(windowDays)) return true;
  return daysBetween(lastProof, now) > windowDays;
}
