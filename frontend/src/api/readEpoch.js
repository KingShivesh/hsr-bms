// An event must never reuse a read that started before the corresponding mutation.
let epoch = 0;
export function readEpoch() { return epoch; }
export function invalidateReads() { epoch += 1; }
