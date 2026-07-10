const RUNTIME_ALIAS = "@codewithkenzo/pi-ai-runtime"
const RUNTIME_PACKAGE = "@earendil-works/pi-ai"
const target = process.argv[2]

if (!target || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
  throw new Error("Usage: bun scripts/update-runtime.ts <semver>")
}

const packageFile = Bun.file(new URL("../package.json", import.meta.url))
const manifest: unknown = await packageFile.json()
if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) {
  throw new Error("package.json dependencies missing")
}
const dependencies = manifest.dependencies
if (typeof dependencies !== "object" || dependencies === null) {
  throw new Error("package.json dependencies malformed")
}

const alias = `npm:${RUNTIME_PACKAGE}@${target}`
Reflect.set(dependencies, RUNTIME_ALIAS, alias)
await Bun.write(packageFile, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Pinned ${RUNTIME_ALIAS} to ${alias}.\n`)
