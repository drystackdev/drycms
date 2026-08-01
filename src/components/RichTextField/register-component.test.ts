import { describe, expect, it } from "vitest";
import { DryComponent } from "./register-component.js";

const component = () => null;

describe("DryComponent naming", () => {
  it("prefers an explicit name", () => {
    const definition = DryComponent({ name: "dry-Hero_Card", label: "Hero", component });
    expect(definition.name).toBe("hero-card");
  });

  it("uses the filename fallback when name is omitted", () => {
    const definition = DryComponent.__fromFile("feature-card", { label: "Feature", component });
    expect(definition.name).toBe("feature-card");
  });

  it("preserves requiredInput when explicitly configured", () => {
    expect(DryComponent({ label: "Defaults", requiredInput: false, component }).requiredInput).toBe(false);
    expect(DryComponent({ label: "Prompt", requiredInput: true, component }).requiredInput).toBe(true);
  });
});
