import {
  EXPECTED_PACKAGE,
  RUNTIME_ALIAS_DEPENDENCY,
  runtimeAliasFromManifest,
  runtimeVersionFromAlias,
} from "./package-metadata.ts"

function stableVersionParts(value: string): readonly [bigint, bigint, bigint] | undefined {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  return match ? [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] : undefined
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = stableVersionParts(left)
  const rightParts = stableVersionParts(right)
  if (!leftParts || !rightParts) throw new Error("Runtime versions must be stable numeric x.y.z")
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }
  return 0
}

function dependenciesFromManifest(manifest: unknown): Record<string, unknown> {
  if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) {
    throw new Error("package.json dependencies missing")
  }
  const dependencies = manifest.dependencies
  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
    throw new Error("package.json dependencies malformed")
  }
  return dependencies as Record<string, unknown>
}

export function updateRuntimeManifest(manifest: unknown, target: string): boolean {
  if (!stableVersionParts(target)) throw new Error("Target runtime must be stable numeric x.y.z")
  const currentAlias = runtimeAliasFromManifest(manifest)
  const current = runtimeVersionFromAlias(currentAlias)
  if (!currentAlias || !current)
    throw new Error("Current runtime alias must be an exact stable pin")
  if (compareStableVersions(target, current) <= 0) return false

  const dependencies = dependenciesFromManifest(manifest)
  dependencies[RUNTIME_ALIAS_DEPENDENCY] = `npm:${EXPECTED_PACKAGE.runtimePackage}@${target}`
  return true
}

async function main(): Promise<void> {
  const target = process.argv[2]
  if (!target || !stableVersionParts(target)) {
    throw new Error("Usage: bun scripts/update-runtime.ts <stable-semver>")
  }

  const packageFile = Bun.file(new URL("../package.json", import.meta.url))
  const manifest: unknown = await packageFile.json()
  const currentAlias = runtimeAliasFromManifest(manifest)
  const current = runtimeVersionFromAlias(currentAlias)
  if (!current) throw new Error("Current runtime alias must be an exact stable pin")

  if (!updateRuntimeManifest(manifest, target)) {
    process.stdout.write(`Runtime remains at ${current}; ${target} is not newer.\n`)
    return
  }

  const alias = `npm:${EXPECTED_PACKAGE.runtimePackage}@${target}`
  await Bun.write(packageFile, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`Pinned ${RUNTIME_ALIAS_DEPENDENCY} to ${alias}.\n`)
}

if (import.meta.main) await main()
