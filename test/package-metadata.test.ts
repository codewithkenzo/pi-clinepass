import { describe, expect, it } from "bun:test"
import {
  EXPECTED_PACKAGE,
  REQUIRED_PACKAGE_FILES,
  validatePackageMetadata,
} from "../scripts/package-metadata.ts"

const CURRENT_RUNTIME_ALIAS = "npm:@earendil-works/pi-ai@0.80.6"

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
      "@codewithkenzo/pi-ai-runtime": CURRENT_RUNTIME_ALIAS,
      effect: EXPECTED_PACKAGE.effect,
    },
    pi: { extensions: [EXPECTED_PACKAGE.main] },
  }
}

describe("packed package metadata validator", () => {
  it("accepts current exact runtime metadata and complete artifact surface", () => {
    expect(validatePackageMetadata(validManifest(), REQUIRED_PACKAGE_FILES)).toEqual([])
  })

  it("accepts a future exact stable runtime alias", () => {
    const manifest = validManifest()
    manifest.dependencies["@codewithkenzo/pi-ai-runtime"] = "npm:@earendil-works/pi-ai@1.24.300"
    expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toEqual([])
  })

  it("rejects latest and range runtime aliases", () => {
    for (const alias of [
      "npm:@earendil-works/pi-ai@latest",
      "npm:@earendil-works/pi-ai@^0.80.6",
      "npm:@earendil-works/pi-ai@>=0.80.6",
    ]) {
      const manifest = validManifest()
      manifest.dependencies["@codewithkenzo/pi-ai-runtime"] = alias
      expect(validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES)).toContain(
        "runtime alias must be an exact npm:@earendil-works/pi-ai@<x.y.z> pin",
      )
    }
  })

  it("rejects an exact alias that mismatches the checked-out release", () => {
    const manifest = validManifest()
    manifest.dependencies["@codewithkenzo/pi-ai-runtime"] = "npm:@earendil-works/pi-ai@0.81.0"
    expect(
      validatePackageMetadata(manifest, REQUIRED_PACKAGE_FILES, {
        expectedRuntimeAlias: CURRENT_RUNTIME_ALIAS,
      }),
    ).toContain(`runtime alias must be ${CURRENT_RUNTIME_ALIAS}`)
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
      (file) => file !== "src/http.ts" && file !== "assets/pi-clinepass-hero.png",
    )
    expect(validatePackageMetadata(validManifest(), files)).toEqual(
      expect.arrayContaining([
        "missing package file: src/http.ts",
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
