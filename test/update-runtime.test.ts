import { describe, expect, it } from "bun:test"
import { compareStableVersions, updateRuntimeManifest } from "../scripts/update-runtime.ts"

function manifest(version: string) {
  return {
    dependencies: {
      "@codewithkenzo/pi-ai-runtime": `npm:@earendil-works/pi-ai@${version}`,
    },
  }
}

describe("runtime updater", () => {
  it("compares stable numeric semver without lexical ordering bugs", () => {
    expect(compareStableVersions("0.80.10", "0.80.9")).toBe(1)
    expect(compareStableVersions("1.0.0", "0.999.999")).toBe(1)
    expect(compareStableVersions("0.80.6", "0.80.6")).toBe(0)
    expect(compareStableVersions("0.79.99", "0.80.0")).toBe(-1)
  })

  it("updates only when target is strictly newer", () => {
    const newer = manifest("0.80.6")
    expect(updateRuntimeManifest(newer, "0.81.0")).toBe(true)
    expect(newer.dependencies["@codewithkenzo/pi-ai-runtime"]).toBe(
      "npm:@earendil-works/pi-ai@0.81.0",
    )

    for (const target of ["0.80.6", "0.79.9"]) {
      const unchanged = manifest("0.80.6")
      expect(updateRuntimeManifest(unchanged, target)).toBe(false)
      expect(unchanged.dependencies["@codewithkenzo/pi-ai-runtime"]).toBe(
        "npm:@earendil-works/pi-ai@0.80.6",
      )
    }
  })

  it("rejects malformed and prerelease targets", () => {
    for (const target of ["latest", "^0.81.0", "0.81.0-beta.1", "01.2.3"]) {
      expect(() => updateRuntimeManifest(manifest("0.80.6"), target)).toThrow(
        "Target runtime must be stable numeric x.y.z",
      )
    }
  })
})
