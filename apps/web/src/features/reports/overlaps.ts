/** Two time ranges (ms) share at least one moment. */
export function overlaps(a: number, b: number, start: number, end: number): boolean {
  return a < end && start < b
}
