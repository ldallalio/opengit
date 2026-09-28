import { describe, expect, it } from "vitest";
import { RequestGeneration, reconcileCheckoutPaths } from "./worktreeState";

describe("checkout request boundaries", () => {
  it("ignores status responses from a checkout that has been switched away from", async () => {
    const requests = new RequestGeneration();
    const first = requests.begin();
    const second = requests.begin();
    let shown = "second checkout";
    await Promise.resolve().then(() => {
      if (requests.isCurrent(first)) shown = "first checkout";
    });
    expect(shown).toBe("second checkout");
    expect(requests.isCurrent(second)).toBe(true);
    requests.invalidate();
    expect(requests.isCurrent(second)).toBe(false);
  });
  it("reconciles a move without duplicating existing tabs or dropping unrelated paths", () => {
    expect(
      reconcileCheckoutPaths(["/main", "/old 雪", "/new"], "/old 雪", "/new"),
    ).toEqual(["/main", "/new"]);
  });
  it("removes only the selected checkout and preserves missing paths", () => {
    expect(
      reconcileCheckoutPaths(["/main", "/old", "/unmounted"], "/old"),
    ).toEqual(["/main", "/unmounted"]);
  });
});
