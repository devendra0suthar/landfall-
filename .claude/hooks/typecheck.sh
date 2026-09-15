#!/usr/bin/env bash
# Landfall — surface breakage the moment a TypeScript file changes.
#
# Runs on PostToolUse for Edit|Write|MultiEdit. Exits silently unless the edited
# file is TypeScript inside this repo AND either `pnpm typecheck` or `pnpm test`
# fails, in which case the errors are handed back so they are dealt with
# immediately rather than discovered three edits later.
#
# Tests run as well as types because every bug this project has actually shipped
# type-checked perfectly: a bank answer written to the wrong field name, a fetch
# flag applied to the wrong function, a separator regex that matched nothing.
# None of those are type errors. All of them are test failures.
set -u

payload=$(cat)

file=$(printf '%s' "$payload" | node -e "
let s='';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(j?.tool_input?.file_path || j?.tool_response?.filePath || '');
  } catch {}
});" 2>/dev/null)

case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

out=$(cd "$root" && pnpm -s -r typecheck 2>&1)
status=$?

if [ "$status" -eq 0 ]; then
  out=$(cd "$root" && pnpm -s test 2>&1)
  status=$?
fi

[ "$status" -eq 0 ] && exit 0

printf '%s' "$out" | node -e "
let s='';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  // tsc diagnostics, or the test runner's own failure lines — not the pnpm
  // exit-status noise wrapped around either.
  const all = s.split('\n').filter((l) => l.trim());
  const errors = all.filter((l) => /error TS[0-9]+|^✖|AssertionError|not ok [0-9]/.test(l));
  const lines = (errors.length ? errors : all).slice(0, 25).join('\n');
  process.stdout.write(JSON.stringify({
    systemMessage: 'typecheck or tests failed after that edit',
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'typecheck or tests failed after this edit:\n' + lines,
    },
  }));
});"
