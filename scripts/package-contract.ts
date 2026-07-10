import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  extensionEntry,
  listTarball,
  packLocalArtifact,
  readTarballManifest,
  requireSuccess,
  runCommand,
} from "./package-artifact.ts"
import {
  assertValidPackageMetadata,
  runtimeVersionFromAlias,
  runtimeAliasFromManifest,
} from "./package-metadata.ts"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-clinepass-package-contract-"))

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

try {
  const packDirectory = join(temporaryRoot, "pack")
  const tarball = await packLocalArtifact(repoRoot, packDirectory)
  const files = await listTarball(tarball)
  const manifest = await readTarballManifest(tarball)
  assertValidPackageMetadata(manifest, files)
  const runtimeAlias = runtimeAliasFromManifest(manifest)
  const targetRuntimeVersion = runtimeVersionFromAlias(runtimeAlias)
  if (!runtimeAlias || !targetRuntimeVersion) {
    throw new Error("Packed manifest runtime alias is not an exact stable version")
  }

  const consumer = join(temporaryRoot, "consumer")
  await mkdir(consumer, { recursive: true })
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        dependencies: { "@codewithkenzo/pi-clinepass": `file:${tarball}` },
      },
      null,
      2,
    )}\n`,
  )
  const installExtension = await runCommand(["npm", "install", "--omit=dev"], { cwd: consumer })
  requireSuccess("production tarball install", installExtension)

  for (const developmentOnly of [
    "oxlint",
    "oxfmt",
    "typescript",
    "@earendil-works/pi-coding-agent",
  ]) {
    const installed = await pathExists(
      join(consumer, "node_modules", ...developmentOnly.split("/")),
    )
    if (installed) {
      throw new Error(
        `Extension dev dependency installed in production consumer: ${developmentOnly}`,
      )
    }
  }
  const installedRuntimeManifest = await Bun.file(
    join(consumer, "node_modules", "@codewithkenzo", "pi-ai-runtime", "package.json"),
  ).json()
  if (
    typeof installedRuntimeManifest !== "object" ||
    installedRuntimeManifest === null ||
    !("version" in installedRuntimeManifest) ||
    installedRuntimeManifest.version !== targetRuntimeVersion
  ) {
    throw new Error(`Installed runtime version must equal alias target ${targetRuntimeVersion}`)
  }
  await access(join(consumer, "node_modules", "effect", "package.json"))

  const installPi = await runCommand(
    ["npm", "install", "--omit=dev", "--save-exact", "@earendil-works/pi-coding-agent@0.80.6"],
    { cwd: consumer },
  )
  requireSuccess("clean consumer Pi install", installPi)
  const smoke = await runCommand(["node", join(repoRoot, "scripts", "container-smoke.mjs")], {
    cwd: consumer,
    env: {
      PI_BIN: join(consumer, "node_modules", ".bin", "pi"),
      EXTENSION_ENTRY: extensionEntry(consumer),
      SMOKE_MODE: "noauth",
    },
  })
  requireSuccess("installed artifact no-auth smoke", smoke)
  if (!smoke.stdout.includes("No-auth ClinePass registration smoke passed.")) {
    throw new Error(`No-auth smoke sentinel missing:\n${smoke.stdout}\n${smoke.stderr}`)
  }

  process.stdout.write(
    `Package contract passed: ${files.length} entries, production-only install, clean Pi no-auth load.\n`,
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
