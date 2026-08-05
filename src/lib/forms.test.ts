import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeForm, isMaterialForm } from "./forms";

describe("describeForm", () => {
  it("translates the common forms into plain English", () => {
    assert.match(describeForm("10-K").label, /annual report/i);
    assert.match(describeForm("8-K").label, /material event/i);
    assert.match(describeForm("4").label, /insider/i);
    assert.match(describeForm("DEF 14A").label, /proxy/i);
  });

  it("links to a concept where P1 authored one", () => {
    assert.equal(describeForm("10-K").concept, "form-10-k");
    assert.equal(describeForm("8-K").concept, "form-8-k");
  });

  it("is case and whitespace insensitive", () => {
    assert.equal(describeForm(" 10-k ").label, describeForm("10-K").label);
  });

  it("handles amendments as the same kind of document", () => {
    const amended = describeForm("10-K/A");
    assert.match(amended.label, /annual report/i);
    assert.match(amended.label, /amended/i);
    assert.match(amended.description, /corrects an earlier filing/i);
    assert.equal(amended.concept, "form-10-k", "still links to the same concept");
  });

  it("degrades gracefully for an unknown form", () => {
    const unknown = describeForm("ABC-99");
    assert.equal(unknown.label, "ABC-99");
    assert.ok(unknown.description.length > 0);
    assert.ok(unknown.weight < 0.5, "unknown forms are not promoted");
  });

  it("maps foreign-issuer forms onto their domestic equivalents", () => {
    assert.equal(describeForm("20-F").concept, "form-10-k");
    assert.equal(describeForm("6-K").concept, "form-8-k");
  });
});

describe("isMaterialForm", () => {
  it("treats reports and material events as material", () => {
    for (const f of ["10-K", "10-Q", "8-K", "DEF 14A", "SC 13D"]) {
      assert.ok(isMaterialForm(f), f);
    }
  });

  it("treats routine insider and plan filings as not material", () => {
    for (const f of ["3", "4", "5", "11-K"]) {
      assert.equal(isMaterialForm(f), false, f);
    }
  });
});
