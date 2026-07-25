import type { FileEntry } from "../components/file-manager-types.js";

/**
 * Flat mock dataset for the FileManager showcase - a few root folders (one
 * nested two levels deep, for breadcrumb + move/copy folder-tree testing)
 * plus a spread of files covering every thumbnail category.
 */
export const fileManagerMock: FileEntry[] = [
  // --- Root folders (size/fileCount are mock aggregates, matching the reference screenshot)
  { id: "docs", name: "Docs", parentId: null, kind: "folder", size: 2_405_181_686, modifiedAt: "2026-07-25T16:50:00", fileCount: 100 },
  { id: "foods", name: "Foods", parentId: null, kind: "folder", size: 400_022_651, modifiedAt: "2026-07-20T11:50:00", fileCount: 600 },
  { id: "projects", name: "Projects", parentId: null, kind: "folder", size: 1_202_590_843, modifiedAt: "2026-07-24T15:50:00", fileCount: 200 },
  { id: "sport", name: "Sport", parentId: null, kind: "folder", size: 480_024_207, modifiedAt: "2026-07-21T12:50:00", fileCount: 150 },
  { id: "training", name: "Training", parentId: null, kind: "folder", size: 600_015_258, modifiedAt: "2026-07-22T13:50:00", fileCount: 80 },
  { id: "work", name: "Work", parentId: null, kind: "folder", size: 800_116_439, modifiedAt: "2026-07-23T14:50:00", fileCount: 220 },

  // --- Root files
  { id: "cover-2", name: "cover-2.jpg", parentId: null, kind: "file", ext: "jpg", size: 47_984_640, modifiedAt: "2026-07-25T16:50:00" },
  { id: "cover-12", name: "cover-12.jpg", parentId: null, kind: "file", ext: "jpg", size: 2_181_038, modifiedAt: "2026-07-03T19:50:00" },
  { id: "cover-18", name: "cover-18.jpg", parentId: null, kind: "file", ext: "jpg", size: 2_086_549, modifiedAt: "2026-07-02T18:50:00" },
  { id: "report", name: "report.pdf", parentId: null, kind: "file", ext: "pdf", size: 812_450, modifiedAt: "2026-07-19T09:12:00" },
  { id: "archive", name: "archive.zip", parentId: null, kind: "file", ext: "zip", size: 15_728_640, modifiedAt: "2026-07-11T14:02:00" },
  { id: "notes", name: "notes.txt", parentId: null, kind: "file", ext: "txt", size: 4_096, modifiedAt: "2026-07-15T08:30:00" },
  { id: "podcast", name: "podcast.mp3", parentId: null, kind: "file", ext: "mp3", size: 9_437_184, modifiedAt: "2026-07-05T21:10:00" },
  { id: "intro", name: "intro.mp4", parentId: null, kind: "file", ext: "mp4", size: 104_857_600, modifiedAt: "2026-07-08T17:45:00" },
  { id: "brand-guide", name: "brand-guide.ai", parentId: null, kind: "file", ext: "ai", size: 6_291_456, modifiedAt: "2026-07-09T10:00:00" },
  { id: "mockup", name: "mockup.psd", parentId: null, kind: "file", ext: "psd", size: 41_943_040, modifiedAt: "2026-07-14T13:25:00" },
  { id: "budget", name: "budget.xlsx", parentId: null, kind: "file", ext: "xlsx", size: 98_304, modifiedAt: "2026-07-17T11:40:00" },
  { id: "proposal", name: "proposal.docx", parentId: null, kind: "file", ext: "docx", size: 235_520, modifiedAt: "2026-07-16T15:05:00" },
  { id: "deck", name: "deck.pptx", parentId: null, kind: "file", ext: "pptx", size: 3_145_728, modifiedAt: "2026-07-18T16:20:00" },

  // --- Inside "Docs"
  { id: "docs-contract", name: "contract.docx", parentId: "docs", kind: "file", ext: "docx", size: 184_320, modifiedAt: "2026-07-20T09:00:00" },
  { id: "docs-invoice", name: "invoice.pdf", parentId: "docs", kind: "file", ext: "pdf", size: 92_160, modifiedAt: "2026-07-21T09:30:00" },
  { id: "docs-readme", name: "readme.txt", parentId: "docs", kind: "file", ext: "txt", size: 1_024, modifiedAt: "2026-07-19T09:00:00" },

  // --- Inside "Projects"
  { id: "projects-website", name: "Website", parentId: "projects", kind: "folder", size: 12_058_624, modifiedAt: "2026-07-23T10:00:00", fileCount: 2 },
  { id: "projects-roadmap", name: "roadmap.xlsx", parentId: "projects", kind: "file", ext: "xlsx", size: 65_536, modifiedAt: "2026-07-22T10:15:00" },

  // --- Inside "Projects/Website"
  { id: "website-design", name: "index-design.ai", parentId: "projects-website", kind: "file", ext: "ai", size: 8_388_608, modifiedAt: "2026-07-23T11:00:00" },
  { id: "website-hero", name: "hero.jpg", parentId: "projects-website", kind: "file", ext: "jpg", size: 3_670_016, modifiedAt: "2026-07-23T11:05:00" },
];
