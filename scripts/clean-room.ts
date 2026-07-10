import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { packLocalArtifact, requireSuccess, runCommand } from "./package-artifact.ts"

const podman = Bun.which("podman")
if (!podman) throw new Error("Podman is mandatory for clean-room validation")

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-clinepass-clean-room-"))
const context = join(temporaryRoot, "context")
const matrix = [
  {
    name: "official-0.73.1",
    packageName: "@mariozechner/pi-coding-agent",
    version: "0.73.1",
  },
  {
    name: "earendil-0.80.6",
    packageName: "@earendil-works/pi-coding-agent",
    version: "0.80.6",
  },
] as const
const tags = matrix.map((entry) => `localhost/pi-clinepass-clean-room:${entry.name}-${process.pid}`)

try {
  const tarball = await packLocalArtifact(repoRoot, join(temporaryRoot, "pack"))
  await mkdir(context, { recursive: true })
  await copyFile(tarball, join(context, "artifact.tgz"))
  await copyFile(
    join(repoRoot, "scripts", "Containerfile.clean-room"),
    join(context, "Containerfile.clean-room"),
  )
  await copyFile(
    join(repoRoot, "scripts", "container-smoke.mjs"),
    join(context, "container-smoke.mjs"),
  )

  for (const [index, entry] of matrix.entries()) {
    const tag = tags[index]
    const build = await runCommand([
      podman,
      "build",
      "--pull=missing",
      "--tag",
      tag,
      "--build-arg",
      `PI_PACKAGE=${entry.packageName}`,
      "--build-arg",
      `PI_VERSION=${entry.version}`,
      "--file",
      join(context, "Containerfile.clean-room"),
      context,
    ])
    requireSuccess(`Podman build ${entry.name}`, build)

    const smoke = await runCommand([podman, "run", "--rm", "--network", "none", tag])
    requireSuccess(`Podman smoke ${entry.name}`, smoke)
    for (const sentinel of [
      "No-auth ClinePass registration smoke passed.",
      "Loopback openai-completions control smoke passed.",
    ]) {
      if (!smoke.stdout.includes(sentinel)) {
        throw new Error(`${entry.name} missing smoke sentinel ${sentinel}:\n${smoke.stdout}`)
      }
    }
    process.stdout.write(`Clean-room matrix passed: ${entry.name}.\n`)
  }
} finally {
  for (const tag of tags) {
    await runCommand([podman, "image", "rm", "--force", tag])
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
