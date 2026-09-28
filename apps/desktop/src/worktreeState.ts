/** Request generations prevent a late checkout response from replacing current UI state. */
export class RequestGeneration {
  private generation = 0;
  begin() {
    return ++this.generation;
  }
  isCurrent(ticket: number) {
    return ticket === this.generation;
  }
  invalidate() {
    this.generation++;
  }
}

/** Move/remove only the affected path and preserve the order of all remaining tabs. */
export function reconcileCheckoutPaths(
  paths: string[],
  oldPath: string,
  newPath?: string,
): string[] {
  return [
    ...new Set(
      paths.flatMap((path) =>
        path === oldPath ? (newPath ? [newPath] : []) : [path],
      ),
    ),
  ];
}
