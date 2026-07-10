import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type CommandResult = {
  readonly exitCode: number
  readonly output: string
}

async function run(command: readonly string[]): Promise<CommandResult> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, output: `${stdout}\n${stderr}` }
}

function requireTool(name: string): string {
  const executable = Bun.which(name)
  if (!executable) throw new Error(`Quality sentinel tool unavailable: ${name}`)
  return executable
}

function proveRejected(label: string, result: CommandResult, expected: readonly string[]): void {
  if (result.exitCode === 0) throw new Error(`${label} accepted deliberate violation`)
  for (const marker of expected) {
    if (!result.output.includes(marker)) {
      throw new Error(
        `${label} failed without expected marker ${JSON.stringify(marker)}:\n${result.output}`,
      )
    }
  }
}

const directory = await mkdtemp(join(tmpdir(), "pi-clinepass-quality-sentinel-"))
const filename = "deliberate-quality-violation.ts"
const target = join(directory, filename)

try {
  await writeFile(target, "const value={bad:true}; debugger\n")
  const oxfmt = await run([requireTool("oxfmt"), "--check", target])
  proveRejected("oxfmt", oxfmt, [filename])

  const oxlint = await run([
    requireTool("oxlint"),
    "--deny-warnings",
    "--deny",
    "no-debugger",
    target,
  ])
  proveRejected("oxlint", oxlint, [filename, "no-debugger"])
  process.stdout.write("Quality sentinels rejected deliberate format and lint violations.\n")
} finally {
  await rm(directory, { recursive: true, force: true })
}
