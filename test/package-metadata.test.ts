import { describe, expect, it } from "bun:test"
import {
  EXPECTED_PACKAGE,
  REQUIRED_PACKAGE_FILES,
  validatePackageMetadata,
} from "../scripts/package-metadata.ts"

function validManifest(): {
  name: string
  version: string
  license: string
  main: string
  publishConfig: { access: string }
  dependencies: Record<string, string>
  pi: { extensions: string[] }
} {
  return {
    name: EXPECTED_PACKAGE.name,
    version: EXPECTED_PACKAGE.version,
    license: EXPECTED_PACKAGE.license,
    main: EXPECTED_PACKAGE.main,
    publishConfig: { access: "public" },
    dependencies: {
      "@codewithkenzo/pi-ai-runtime": EXPECTED_PACKAGE.runtimeAlias,
      effect: EXPECTED_PACKAGE.effect,
    },
    pi: { extensions: [EXPECTED_PACKAGE.main] },
  }
}

describe("packed package metadata validator", () => {
  it("accepts release metadata and complete artifact surface", () => {
    expect(validatePackageMetadata(validManifest(), REQUIRED_PACKAGE_FILES)).toEqual([])
  })

  it("rejects a latest runtime alias", () => {
    const manifest = validManifest()
    manifest.dependencies["@codewithkenzo/pi-ai-runtime"] = "npm:@earendil-works/pi-ai@latest"
    expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toContain(
      `runtime alias must be ${EXPECTED_PACKAGE.runtimeAlias}`,
    )
  })

  it("rejects legacy peer dependencies", () => {
    const manifest = { ...validManifest(), peerDependencies: { effect: "^3" } }
    expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toContain(
      "peerDependencies must be absent",
    )
  })

  it("rejects wrong Effect range", () => {
    const manifest = validManifest()
    manifest.dependencies.effect = "^3.0.0"
    expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toContain(
      `effect must be ${EXPECTED_PACKAGE.effect}`,
    )
  })

  it("rejects missing runtime source and asset files", () => {
    const files = REQUIRED_PACKAGE_FILES.filter(
      (file) => file !== "src/index.ts" && file !== "assets/pi-clinepass-hero.png",
    )
    expect(validatePackageMetadata(validManifest(), files)).toEqual(
      expect.arrayContaining([
        "missing package file: src/index.ts",
        "missing package file: assets/pi-clinepass-hero.png",
      ]),
    )
  })

  it("rejects wrong release version", () => {
    const manifest = { ...validManifest(), version: "0.1.0" }
    expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toContain(
      `version must be ${EXPECTED_PACKAGE.version}`,
    )
  })
})
