import fs from "fs/promises";
import path from "path";
import type { Page } from "playwright";

export const EVIDENCE_ROOT = path.resolve(process.cwd(), "uploads", "applications");
const SAFE_ID = /^[a-z0-9]{10,40}$/i;

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";
}

export class Evidence {
  readonly dir: string;
  readonly relativeDir: string;
  private step = 0;
  private lines: string[] = [];

  constructor(readonly applicationId: string) {
    if (!SAFE_ID.test(applicationId)) throw new Error("Invalid application id");
    this.dir = path.join(EVIDENCE_ROOT, applicationId);
    this.relativeDir = path.posix.join("uploads", "applications", applicationId);
  }

  async init(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.dir, { recursive: true });
  }

  log(message: string): void {
    this.lines.push(`${new Date().toISOString()} ${message}`);
  }

  async screenshot(page: Page, label: string): Promise<string | null> {
    this.step += 1;
    const file = `${String(this.step).padStart(2, "0")}-${slug(label)}.png`;
    try {
      await page.screenshot({ path: path.join(this.dir, file), fullPage: false });
    } catch (err) {
      this.log(`screenshot failed: ${(err as Error).message}`);
      return null;
    }
    return file;
  }

  async savePayload(payload: Record<string, string>): Promise<void> {
    await fs.writeFile(path.join(this.dir, "payload.json"), JSON.stringify(payload, null, 2));
  }

  async flush(): Promise<void> {
    await fs.writeFile(path.join(this.dir, "log.txt"), this.lines.join("\n") + "\n");
  }

  urlFor(file = ""): string {
    return `/api/apply/evidence/${this.applicationId}/${file}`;
  }
}
