export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  process: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const settled = await Promise.allSettled(items.slice(start, start + batchSize).map(process));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value !== null) results.push(outcome.value);
    }
  }
  return results;
}
