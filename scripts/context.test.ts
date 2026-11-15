import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPersistedContext } from "./context";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "context-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("persisted task context", () => {
  it("rebuilds a short context from safety, current state, and related handoffs", async () => {
    const root = await tempDir();
    await mkdir(join(root, "harness/state"), { recursive: true });
    await mkdir(join(root, "harness/handoffs"), { recursive: true });
    await mkdir(join(root, "harness/logs"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "Keep all safety rules.");
    await writeFile(
      join(root, "harness/state/current.md"),
      "P00-04 is the current task.",
    );
    await writeFile(
      join(root, "harness/handoffs/P00-04.md"),
      "Resume from the latest verified checkpoint.",
    );
    await writeFile(
      join(root, "harness/handoffs/P00-03.md"),
      "The direct dependency completed.",
    );
    await writeFile(
      join(root, "harness/handoffs/P00-02.md"),
      "Unrelated older handoff.",
    );
    await writeFile(join(root, "harness/logs/large.json"), "raw tool output");

    const context = await buildPersistedContext(root, {
      id: "P00-04",
      depends: ["P00-03"],
    });

    expect(context.sources).toEqual([
      "AGENTS.md",
      "harness/state/current.md",
      "harness/handoffs/P00-04.md",
      "harness/handoffs/P00-03.md",
    ]);
    expect(context.text).toContain("Keep all safety rules.");
    expect(context.text).toContain("P00-04 is the current task.");
    expect(context.text).toContain("latest verified checkpoint");
    expect(context.text).toContain("direct dependency completed");
    expect(context.text).not.toContain("Unrelated older handoff");
    expect(context.text).not.toContain(
      await readFile(join(root, "harness/logs/large.json"), "utf8"),
    );
    expect(context.text).toContain(
      "rerun relevant checks before claiming completion",
    );
  });

  it("fails closed when repository safety instructions are missing", async () => {
    await expect(
      buildPersistedContext(await tempDir(), {
        id: "P00-04",
        depends: ["P00-03"],
      }),
    ).rejects.toThrow();
  });

  it("rejects handoff identifiers that could escape the handoff directory", async () => {
    const root = await tempDir();
    await writeFile(join(root, "AGENTS.md"), "Keep all safety rules.");

    await expect(
      buildPersistedContext(root, {
        id: "../../secrets",
        depends: ["P00-03"],
      }),
    ).rejects.toThrow("invalid handoff identifier");
  });
});
