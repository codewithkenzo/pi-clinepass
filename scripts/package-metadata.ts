export const EXPECTED_PACKAGE = {
  name: "@codewithkenzo/pi-clinepass",
  version: "0.1.1",
  license: "MIT",
  main: "./src/index.ts",
  runtimePackage: "@earendil-works/pi-ai",
  effect: "^4.0.0-beta.93",
} as const

export const RUNTIME_ALIAS_DEPENDENCY = "@codewithkenzo/pi-ai-runtime"

export const REQUIRED_PACKAGE_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "assets/pi-clinepass-hero.png",
  "src/config.ts",
  "src/constants.ts",
  "src/discovery.ts",
  "src/error-handler.ts",
  "src/errors.ts",
  "src/http.ts",
  "src/index.ts",
  "src/pi-oauth.ts",
] as const

const FORBIDDEN_PACKAGE_PATHS = [
  /^test\//,
  /^tests\//,
  /^docs\//,
  /^scripts\//,
  /^\.github\//,
  /^(?:bun\.lock|package-lock\.json|tsconfig\.json)$/,
  /^\.ox(?:lint|fmt)rc\.json$/,
]

const STABLE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const RUNTIME_ALIAS_PREFIX = `npm:${EXPECTED_PACKAGE.runtimePackage}@`

export interface PackageMetadataExpectations {
  readonly expectedVersion?: string
  readonly expectedRuntimeAlias?: string
  readonly expectedEffect?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined
}

export function runtimeVersionFromAlias(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith(RUNTIME_ALIAS_PREFIX)) return undefined
  const version = value.slice(RUNTIME_ALIAS_PREFIX.length)
  return STABLE_SEMVER.test(version) ? version : undefined
}

export function runtimeAliasFromManifest(manifest: unknown): string | undefined {
  const value = record(manifest)
  const dependencies = record(value?.dependencies)
  const alias = dependencies?.[RUNTIME_ALIAS_DEPENDENCY]
  return runtimeVersionFromAlias(alias) ? (alias as string) : undefined
}

export function effectFromManifest(manifest: unknown): string | undefined {
  const value = record(manifest)
  const dependencies = record(value?.dependencies)
  return typeof dependencies?.effect === "string" ? dependencies.effect : undefined
}

export function validatePackageMetadata(
  manifest: unknown,
  files: readonly string[],
  expectations: PackageMetadataExpectations = {},
): string[] {
  const issues: string[] = []
  const value = record(manifest)
  if (!value) return ["package manifest must be an object"]

  const expectedVersion = expectations.expectedVersion ?? EXPECTED_PACKAGE.version
  const expectedEffect = expectations.expectedEffect ?? EXPECTED_PACKAGE.effect

  if (value.name !== EXPECTED_PACKAGE.name) issues.push(`name must be ${EXPECTED_PACKAGE.name}`)
  if (value.version !== expectedVersion) issues.push(`version must be ${expectedVersion}`)
  if (value.license !== EXPECTED_PACKAGE.license)
    issues.push(`license must be ${EXPECTED_PACKAGE.license}`)
  if (value.main !== EXPECTED_PACKAGE.main) issues.push(`main must be ${EXPECTED_PACKAGE.main}`)

  const publishConfig = record(value.publishConfig)
  if (publishConfig?.access !== "public") issues.push("publishConfig.access must be public")

  const dependencies = record(value.dependencies)
  const runtimeAlias = dependencies?.[RUNTIME_ALIAS_DEPENDENCY]
  if (!runtimeVersionFromAlias(runtimeAlias)) {
    issues.push(`runtime alias must be an exact npm:${EXPECTED_PACKAGE.runtimePackage}@<x.y.z> pin`)
  } else if (
    expectations.expectedRuntimeAlias !== undefined &&
    runtimeAlias !== expectations.expectedRuntimeAlias
  ) {
    issues.push(`runtime alias must be ${expectations.expectedRuntimeAlias}`)
  }
  if (dependencies?.effect !== expectedEffect) issues.push(`effect must be ${expectedEffect}`)
  if ("peerDependencies" in value) issues.push("peerDependencies must be absent")

  const pi = record(value.pi)
  const extensions = stringArray(pi?.extensions)
  if (!extensions || extensions.length !== 1 || extensions[0] !== EXPECTED_PACKAGE.main) {
    issues.push(`pi.extensions must contain only ${EXPECTED_PACKAGE.main}`)
  }

  const normalized = new Set(files.map((file) => file.replace(/^package\//, "")))
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!normalized.has(required)) issues.push(`missing package file: ${required}`)
  }
  for (const file of normalized) {
    if (FORBIDDEN_PACKAGE_PATHS.some((pattern) => pattern.test(file))) {
      issues.push(`forbidden package file: ${file}`)
    }
  }
  return issues
}

export function assertValidPackageMetadata(
  manifest: unknown,
  files: readonly string[],
  expectations?: PackageMetadataExpectations,
): void {
  const issues = validatePackageMetadata(manifest, files, expectations)
  if (issues.length > 0) throw new Error(`Package contract failed:\n- ${issues.join("\n- ")}`)
}
