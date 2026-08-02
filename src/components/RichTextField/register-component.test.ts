import { describe, expect, it } from "vitest";
import { h } from "preact";
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

  it("keeps an optional Preact icon and supports updating it", () => {
    const firstIcon = () => null;
    const secondIcon = () => null;
    const definition = DryComponent({ label: "Icon", icon: firstIcon, component });
    expect(definition.icon).toBe(firstIcon);
    definition.update({ icon: secondIcon });
    expect(definition.icon).toBe(secondIcon);
  });

  it("accepts a JSX icon element", () => {
    const icon = h("svg", { viewBox: "0 0 24 24" }, h("path", { d: "M0 0" }));
    expect(DryComponent({ label: "Icon", icon, component }).icon).toBe(icon);
  });
});
