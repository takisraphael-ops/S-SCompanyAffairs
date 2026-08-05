import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dependents, findCycle, transitivePrerequisites } from "./dag";

describe("findCycle", () => {
  it("returns null for an acyclic graph", () => {
    assert.equal(
      findCycle([
        { slug: "a", requires: [] },
        { slug: "b", requires: ["a"] },
        { slug: "c", requires: ["a", "b"] },
      ]),
      null,
    );
  });

  it("detects a two-node cycle", () => {
    const cycle = findCycle([
      { slug: "a", requires: ["b"] },
      { slug: "b", requires: ["a"] },
    ]);
    assert.ok(cycle, "expected a cycle");
    assert.ok(cycle.length >= 3, cycle.join(" -> "));
    assert.equal(cycle[0], cycle[cycle.length - 1], "cycle should close");
  });

  it("detects a longer cycle", () => {
    const cycle = findCycle([
      { slug: "a", requires: ["b"] },
      { slug: "b", requires: ["c"] },
      { slug: "c", requires: ["a"] },
    ]);
    assert.ok(cycle);
    assert.deepEqual(new Set(cycle), new Set(["a", "b", "c"]));
  });

  it("ignores unknown references rather than calling them cycles", () => {
    assert.equal(
      findCycle([{ slug: "a", requires: ["does-not-exist"] }]),
      null,
    );
  });

  it("handles a diamond, which is legal in a DAG", () => {
    assert.equal(
      findCycle([
        { slug: "base", requires: [] },
        { slug: "left", requires: ["base"] },
        { slug: "right", requires: ["base"] },
        { slug: "top", requires: ["left", "right"] },
      ]),
      null,
    );
  });
});

describe("transitivePrerequisites", () => {
  const graph = [
    { slug: "net-income", requires: ["revenue"] },
    { slug: "revenue", requires: [] },
    { slug: "shares", requires: [] },
    { slug: "eps", requires: ["net-income", "shares"] },
    { slug: "pe", requires: ["price", "eps"] },
    { slug: "price", requires: [] },
  ];

  it("collects prerequisites transitively", () => {
    const path = transitivePrerequisites("pe", graph);
    assert.deepEqual(new Set(path), new Set(["price", "eps", "net-income", "revenue", "shares"]));
  });

  it("excludes the concept itself", () => {
    assert.ok(!transitivePrerequisites("pe", graph).includes("pe"));
  });

  it("orders dependencies before the things that need them", () => {
    const path = transitivePrerequisites("pe", graph);
    assert.ok(
      path.indexOf("revenue") < path.indexOf("net-income"),
      `revenue must precede net-income: ${path.join(", ")}`,
    );
    assert.ok(
      path.indexOf("net-income") < path.indexOf("eps"),
      `net-income must precede eps: ${path.join(", ")}`,
    );
  });

  it("returns an empty list for a root concept", () => {
    assert.deepEqual(transitivePrerequisites("revenue", graph), []);
  });

  it("does not repeat a shared prerequisite", () => {
    const path = transitivePrerequisites("top", [
      { slug: "base", requires: [] },
      { slug: "left", requires: ["base"] },
      { slug: "right", requires: ["base"] },
      { slug: "top", requires: ["left", "right"] },
    ]);
    assert.equal(path.filter((s) => s === "base").length, 1);
  });
});

describe("dependents", () => {
  it("finds direct dependents only", () => {
    const graph = [
      { slug: "a", requires: [] },
      { slug: "b", requires: ["a"] },
      { slug: "c", requires: ["b"] },
    ];
    assert.deepEqual(dependents("a", graph), ["b"]);
    assert.deepEqual(dependents("c", graph), []);
  });
});
