import { describe, expect, it } from "vitest";
import { rewriteImportsAfterMove } from "./import-rewrite.js";

describe("rewriteImportsAfterMove", () => {
  it("rewrites another file's import of the moved file to its new path", () => {
    const sourceByPath = {
      "Button.tsx": 'export default function Button() { return <button />; }\n',
      "Demo.tsx": 'import Button from "./Button.tsx";\nexport default function Demo() { return <Button />; }\n',
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "Button.tsx", "widgets/Button.tsx");
    expect(updates).toEqual({
      "Demo.tsx": 'import Button from "./widgets/Button.tsx";\nexport default function Demo() { return <Button />; }\n',
    });
  });

  it("recomputes the moved file's own relative imports when it leaves a folder", () => {
    const sourceByPath = {
      "layout/Header.tsx": 'import Logo from "./Logo.tsx";\nexport default function Header() { return <Logo />; }\n',
      "layout/Logo.tsx": "export default function Logo() { return <svg />; }\n",
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "layout/Header.tsx", "Header.tsx");
    expect(updates["Header.tsx"]).toBe(
      'import Logo from "./layout/Logo.tsx";\nexport default function Header() { return <Logo />; }\n',
    );
  });

  it("recomputes the moved file's own relative imports when it enters a folder", () => {
    const sourceByPath = {
      "Header.tsx": 'import Button from "./Button.tsx";\nexport default function Header() { return <Button />; }\n',
      "Button.tsx": "export default function Button() { return <button />; }\n",
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "Header.tsx", "layout/Header.tsx");
    expect(updates["layout/Header.tsx"]).toBe(
      'import Button from "../Button.tsx";\nexport default function Header() { return <Button />; }\n',
    );
  });

  it("leaves bare/npm specifiers untouched", () => {
    const sourceByPath = {
      "Demo.tsx": 'import { useState } from "preact/hooks";\nexport default function Demo() { return null; }\n',
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "Demo.tsx", "widgets/Demo.tsx");
    expect(updates).toEqual({});
  });

  it("leaves unrelated files' imports untouched", () => {
    const sourceByPath = {
      "Button.tsx": "export default function Button() { return <button />; }\n",
      "Other.tsx": 'import Icon from "./Icon.tsx";\nexport default function Other() { return <Icon />; }\n',
      "Icon.tsx": "export default function Icon() { return <svg />; }\n",
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "Button.tsx", "widgets/Button.tsx");
    expect(updates).toEqual({});
  });

  it("returns no update for a file whose import target didn't move, even if the specifier looks similar", () => {
    const sourceByPath = {
      "Demo.tsx": 'import Button from "./ButtonGroup.tsx";\n',
      "ButtonGroup.tsx": "export default function ButtonGroup() { return null; }\n",
    };
    const updates = rewriteImportsAfterMove(sourceByPath, "Button.tsx", "widgets/Button.tsx");
    expect(updates).toEqual({});
  });
});
