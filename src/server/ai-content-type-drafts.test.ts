import { describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../content-types/types.js";

vi.mock("./config.js", () => ({ path: "/dry" }));

const { listAiContentTypeDrafts, saveAiContentTypeDraft, deleteAiContentTypeDraft } = await import("./ai-content-type-drafts.js");

function definition(id: string, name: string): ContentTypeDefinition {
  return { id, kind: "collection", name, label: name, fields: [], version: 0 } as ContentTypeDefinition;
}

describe("ai-content-type-drafts", () => {
  it("saves and lists a pending draft, then removes it on delete", async () => {
    const userId = 9001;
    await saveAiContentTypeDraft(userId, { id: "d1", definition: definition("d1", "post"), isNew: true, createdAt: new Date().toISOString() }, {});
    const listed = await listAiContentTypeDrafts(userId, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]!.definition.name).toBe("post");

    await deleteAiContentTypeDraft(userId, "d1", {});
    expect(await listAiContentTypeDrafts(userId, {})).toHaveLength(0);
  });

  it("overwrites an existing draft with the same id rather than duplicating it", async () => {
    const userId = 9002;
    await saveAiContentTypeDraft(userId, { id: "d1", definition: definition("d1", "post"), isNew: true, createdAt: new Date().toISOString() }, {});
    await saveAiContentTypeDraft(userId, { id: "d1", definition: definition("d1", "post-renamed"), isNew: true, createdAt: new Date().toISOString() }, {});
    const listed = await listAiContentTypeDrafts(userId, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]!.definition.name).toBe("post-renamed");
  });

  it("keeps drafts scoped per user", async () => {
    const userA = 9003;
    const userB = 9004;
    await saveAiContentTypeDraft(userA, { id: "a1", definition: definition("a1", "a-type"), isNew: true, createdAt: new Date().toISOString() }, {});
    expect(await listAiContentTypeDrafts(userB, {})).toHaveLength(0);
    expect(await listAiContentTypeDrafts(userA, {})).toHaveLength(1);
  });

  it("evicts the oldest draft once the per-user cap is exceeded", async () => {
    const userId = 9005;
    for (let i = 0; i < 21; i++) {
      await saveAiContentTypeDraft(
        userId,
        { id: `d${i}`, definition: definition(`d${i}`, `type-${i}`), isNew: true, createdAt: new Date().toISOString() },
        {},
      );
    }
    const listed = await listAiContentTypeDrafts(userId, {});
    expect(listed).toHaveLength(20);
    expect(listed.some((draft) => draft.id === "d0")).toBe(false);
    expect(listed.some((draft) => draft.id === "d20")).toBe(true);
  });
});
