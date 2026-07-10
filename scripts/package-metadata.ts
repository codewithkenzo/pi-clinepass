export const EXPECTED_PACKAGE = {
  name: "@codewithkenzo/pi-clinepass",
  version: "0.1.1",
  license: "MIT",
  main: "./src/index.ts",
  runtimeAlias: "npm:@earendil-works/pi-ai@0.80.6",
  effect: "^4.0.0-beta.93",
} as const

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

export function validatePackageMetadata(
  manifest: unknown,
  files: readonly string[],
  expectedVersion: string = EXPECTED_PACKAGE.version,
): string[] {
  const issues: string[] = []
  const value = record(manifest)
  if (!value) return ["package manifest must be an object"]

  if (value.name !== EXPECTED_PACKAGE.name) issues.push(`name must be ${EXPECTED_PACKAGE.name}`)
  if (value.version !== expectedVersion) issues.push(`version must be ${expectedVersion}`)
  if (value.license !== EXPECTED_PACKAGE.license)
    issues.push(`license must be ${EXPECTED_PACKAGE.license}`)
  if (value.main !== EXPECTED_PACKAGE.main) issues.push(`main must be ${EXPECTED_PACKAGE.main}`)

  const publishConfig = record(value.publishConfig)
  if (publishConfig?.access !== "public") issues.push("publishConfig.access must be public")

  const dependencies = record(value.dependencies)
  if (dependencies?.["@codewithkenzo/pi-ai-runtime"] !== EXPECTED_PACKAGE.runtimeAlias) {
    issues.push(`runtime alias must be ${EXPECTED_PACKAGE.runtimeAlias}`)
  }
  if (dependencies?.effect !== EXPECTED_PACKAGE.effect) {
    issues.push(`effect must be ${EXPECTED_PACKAGE.effect}`)
  }
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
  expectedVersion?: string,
): void {
  const issues = validatePackageMetadata(manifest, files, expectedVersion)
  if (issues.length > 0) throw new Error(`Package contract failed:\n- ${issues.join("\n- ")}`)
}
