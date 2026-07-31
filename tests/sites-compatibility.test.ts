import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("Sites candidate keeps hosting stateless and removes starter metadata", async () => {
  const [hostingText, page, layout, vite, packageText] = await Promise.all([
    text(".openai/hosting.json"),
    text("app/page.tsx"),
    text("app/layout.tsx"),
    text("vite.config.ts"),
    text("package.json"),
  ]);
  const hosting = JSON.parse(hostingText) as Record<string, unknown>;
  const packageJson = JSON.parse(packageText) as { dependencies?: Record<string, string> };

  assert.deepEqual(hosting, { d1: null, r2: null });
  assert.equal("project_id" in hosting, false);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview|_sites-preview/);
  assert.match(page, /GreenProof · Shared rooftop evidence/);
  assert.match(layout, /GreenProof · Local energy evidence/);
  assert.match(vite, /sites\(\)/);
  assert.equal(packageJson.dependencies?.["react-loading-skeleton"], undefined);
});
test("all deployable scenario assets remain present in the index", async () => {
  const index = JSON.parse(await text("public/data/scenarios/index.json")) as Array<{ path: string }>;
  assert.equal(index.length, 3);
  for (const entry of index) {
    const relativePath = entry.path.replace(/^\//, "public/");
    const scenario = JSON.parse(await text(relativePath)) as { schemaVersion?: string; site?: unknown };
    assert.equal(scenario.schemaVersion, "1.0.0");
    assert.ok(scenario.site);
  }
});
