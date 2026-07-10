import { mkdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

export type CommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export async function runCommand(
  command: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

export function requireSuccess(label: string, result: CommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (${result.exitCode}):\n${result.stdout}\n${result.stderr}`)
  }
}

async function packArtifact(
  npmArguments: readonly string[],
  destination: string,
  cwd?: string,
): Promise<string> {
  await mkdir(destination, { recursive: true })
  const result = await runCommand(
    ["npm", "pack", ...npmArguments, "--json", "--pack-destination", destination],
    { cwd },
  )
  requireSuccess("npm pack", result)
  let report: unknown
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(`npm pack returned invalid JSON:\n${result.stdout}`)
  }
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error(
      `npm pack returned ${Array.isArray(report) ? report.length : "invalid"} entries`,
    )
  }
  const entry = report[0]
  if (typeof entry !== "object" || entry === null || !("filename" in entry)) {
    throw new Error("npm pack report missing filename")
  }
  const filename = entry.filename
  if (typeof filename !== "string" || basename(filename) !== filename) {
    throw new Error("npm pack filename is unsafe")
  }
  return resolve(destination, filename)
}

export function packLocalArtifact(repoRoot: string, destination: string): Promise<string> {
  return packArtifact([], destination, repoRoot)
}

export function packRegistryArtifact(specifier: string, destination: string): Promise<string> {
  return packArtifact([specifier], destination)
}

export async function listTarball(tarball: string): Promise<string[]> {
  const result = await runCommand(["tar", "-tzf", tarball])
  requireSuccess("tar list", result)
  return result.stdout
    .split("\n")
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter(Boolean)
}

export async function readTarballManifest(tarball: string): Promise<unknown> {
  const result = await runCommand(["tar", "-xOzf", tarball, "package/package.json"])
  requireSuccess("tar manifest extract", result)
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error("packed package.json is invalid JSON")
  }
}

export function extensionEntry(consumer: string): string {
  return join(consumer, "node_modules", "@codewithkenzo", "pi-clinepass", "src", "index.ts")
}
