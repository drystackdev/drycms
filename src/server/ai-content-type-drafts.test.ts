import { describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../content-types/types.js";

vi.mock("./config.js", () => ({ path: "/dry" }));

const { listAiContentTypeDrafts, saveAiContentTypeDraft, deleteAiContentTypeDraft, getAiContentTypeDraftsVersion } = await import("./ai-content-type-drafts.js");

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

  it("isolates the same content-type id across users, including delete", async () => {
    const userA = 9010;
    const userB = 9011;
    await saveAiContentTypeDraft(userA, { id: "shared-id", definition: definition("shared-id", "a-version"), isNew: false, createdAt: new Date().toISOString() }, {});
    await saveAiContentTypeDraft(userB, { id: "shared-id", definition: definition("shared-id", "b-version"), isNew: false, createdAt: new Date().toISOString() }, {});

    expect((await listAiContentTypeDrafts(userA, {}))[0]!.definition.name).toBe("a-version");
    expect((await listAiContentTypeDrafts(userB, {}))[0]!.definition.name).toBe("b-version");

    await deleteAiContentTypeDraft(userA, "shared-id", {});
    expect(await listAiContentTypeDrafts(userA, {})).toEqual([]);
    expect((await listAiContentTypeDrafts(userB, {}))[0]!.definition.name).toBe("b-version");
  });

  it("prunes an expired record from both the visible list and versioned index", async () => {
    vi.useFakeTimers();
    try {
      const userId = 9012;
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await saveAiContentTypeDraft(userId, { id: "expires", definition: definition("expires", "temporary"), isNew: true, createdAt: new Date().toISOString() }, {});
      const savedVersion = await getAiContentTypeDraftsVersion(userId, {});

      vi.setSystemTime(new Date("2026-02-01T00:00:01Z"));
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(savedVersion + 1);
      expect(await listAiContentTypeDrafts(userId, {})).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
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

  describe("version counter (routes/ai-content-type-drafts.ts's data-version poll)", () => {
    it("starts at 0 for a user with no drafts, and bumps by 1 on every save/delete that actually changes something", async () => {
      const userId = 9006;
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(0);

      await saveAiContentTypeDraft(userId, { id: "v1", definition: definition("v1", "versioned"), isNew: true, createdAt: new Date().toISOString() }, {});
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(1);

      // Overwriting the SAME id still bumps - it's a real change to the
      // resource (`saveAiContentTypeDraft` always saves), same as any other
      // write path this counter tracks.
      await saveAiContentTypeDraft(userId, { id: "v1", definition: definition("v1", "versioned-renamed"), isNew: true, createdAt: new Date().toISOString() }, {});
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(2);

      await deleteAiContentTypeDraft(userId, "v1", {});
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(3);
    });

    it("does not bump on a delete that matches nothing (a no-op write must not fool a poller into thinking something changed)", async () => {
      const userId = 9007;
      await saveAiContentTypeDraft(userId, { id: "v1", definition: definition("v1", "versioned"), isNew: true, createdAt: new Date().toISOString() }, {});
      const afterSave = await getAiContentTypeDraftsVersion(userId, {});

      await deleteAiContentTypeDraft(userId, "does-not-exist", {});
      expect(await getAiContentTypeDraftsVersion(userId, {})).toBe(afterSave);
    });

    it("is scoped per user, like the drafts themselves", async () => {
      const userA = 9008;
      const userB = 9009;
      await saveAiContentTypeDraft(userA, { id: "a1", definition: definition("a1", "a-type"), isNew: true, createdAt: new Date().toISOString() }, {});
      expect(await getAiContentTypeDraftsVersion(userA, {})).toBe(1);
      expect(await getAiContentTypeDraftsVersion(userB, {})).toBe(0);
    });
  });
});
