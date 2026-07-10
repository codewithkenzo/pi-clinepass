import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  extensionEntry,
  listTarball,
  packRegistryArtifact,
  readTarballManifest,
  requireSuccess,
  runCommand,
} from "./package-artifact.ts"
import {
  assertValidPackageMetadata,
  effectFromManifest,
  EXPECTED_PACKAGE,
  REQUIRED_PACKAGE_FILES,
  runtimeAliasFromManifest,
} from "./package-metadata.ts"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: bun scripts/registry-contract.ts <version>")
}

const specifier = `${EXPECTED_PACKAGE.name}@${version}`
const attempts = Number(process.env.REGISTRY_POLL_ATTEMPTS ?? "20")
const intervalMs = Number(process.env.REGISTRY_POLL_INTERVAL_MS ?? "15000")
if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(intervalMs) || intervalMs < 0) {
  throw new Error("Registry poll settings are invalid")
}

async function registryMetadata(): Promise<unknown> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runCommand(["npm", "view", specifier, "--json"])
    if (result.exitCode === 0) {
      try {
        return JSON.parse(result.stdout)
      } catch {
        throw new Error(`npm view returned invalid JSON:\n${result.stdout}`)
      }
    }
    if (attempt === attempts) {
      throw new Error(`Registry did not expose ${specifier}:\n${result.stdout}\n${result.stderr}`)
    }
    process.stdout.write(`Registry poll ${attempt}/${attempts}: ${specifier} not visible yet.\n`)
    await Bun.sleep(intervalMs)
  }
  throw new Error("Registry polling exhausted")
}

function registryIntegrity(metadata: unknown): string {
  if (typeof metadata !== "object" || metadata === null || !("dist" in metadata)) {
    throw new Error("Registry metadata missing dist")
  }
  const dist = metadata.dist
  if (typeof dist !== "object" || dist === null || !("integrity" in dist)) {
    throw new Error("Registry metadata missing dist.integrity")
  }
  if (typeof dist.integrity !== "string" || !dist.integrity.startsWith("sha512-")) {
    throw new Error("Registry dist.integrity must be sha512")
  }
  return dist.integrity
}

async function sha512Integrity(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha512")
  hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()))
  return `sha512-${hasher.digest("base64")}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const releaseManifest: unknown = await Bun.file(join(repoRoot, "package.json")).json()
const releaseVersion =
  typeof releaseManifest === "object" &&
  releaseManifest !== null &&
  "version" in releaseManifest &&
  typeof releaseManifest.version === "string"
    ? releaseManifest.version
    : undefined
const releaseRuntimeAlias = runtimeAliasFromManifest(releaseManifest)
const releaseEffect = effectFromManifest(releaseManifest)
if (releaseVersion !== version) {
  throw new Error(`Release manifest version ${String(releaseVersion)} does not match ${version}`)
}
if (!releaseRuntimeAlias)
  throw new Error("Release manifest runtime alias must be exact stable semver")
if (!releaseEffect) throw new Error("Release manifest Effect dependency missing")
const releaseExpectations = {
  expectedVersion: releaseVersion,
  expectedRuntimeAlias: releaseRuntimeAlias,
  expectedEffect: releaseEffect,
}
assertValidPackageMetadata(releaseManifest, REQUIRED_PACKAGE_FILES, releaseExpectations)

const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-clinepass-registry-contract-"))

try {
  const metadata = await registryMetadata()
  const tarball = await packRegistryArtifact(specifier, join(temporaryRoot, "pack"))
  const files = await listTarball(tarball)
  const packedManifest = await readTarballManifest(tarball)
  assertValidPackageMetadata(metadata, files, releaseExpectations)
  assertValidPackageMetadata(packedManifest, files, releaseExpectations)
  const expectedIntegrity = registryIntegrity(metadata)
  const actualIntegrity = await sha512Integrity(tarball)
  if (actualIntegrity !== expectedIntegrity) {
    throw new Error(
      `Registry tarball integrity mismatch: ${actualIntegrity} != ${expectedIntegrity}`,
    )
  }

  const consumer = join(temporaryRoot, "consumer")
  await mkdir(consumer, { recursive: true })
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        dependencies: {
          [EXPECTED_PACKAGE.name]: version,
          "@mariozechner/pi-coding-agent": "0.73.1",
        },
      },
      null,
      2,
    )}\n`,
  )
  const install = await runCommand(["npm", "install", "--omit=dev"], { cwd: consumer })
  requireSuccess("public registry consumer install", install)
  const installedManifest = join(
    consumer,
    "node_modules",
    "@codewithkenzo",
    "pi-clinepass",
    "package.json",
  )
  if (!(await pathExists(installedManifest))) throw new Error("Public package was not installed")

  const smoke = await runCommand(["node", join(repoRoot, "scripts", "container-smoke.mjs")], {
    cwd: consumer,
    env: {
      PI_BIN: join(consumer, "node_modules", ".bin", "pi"),
      EXTENSION_ENTRY: extensionEntry(consumer),
      SMOKE_MODE: "noauth",
    },
  })
  requireSuccess("public registry official Pi smoke", smoke)
  if (!smoke.stdout.includes("No-auth ClinePass registration smoke passed.")) {
    throw new Error(`Public registry smoke sentinel missing:\n${smoke.stdout}\n${smoke.stderr}`)
  }
  process.stdout.write(`Registry contract passed for ${specifier}.\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
