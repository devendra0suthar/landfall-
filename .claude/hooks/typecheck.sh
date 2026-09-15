#!/usr/bin/env bash
# Landfall — surface type breakage the moment a TypeScript file changes.
#
# Runs on PostToolUse for Edit|Write|MultiEdit. Exits silently unless the edited
# file is TypeScript inside this repo AND `pnpm typecheck` fails, in which case
# the errors are handed back so they are dealt with immediately rather than
# discovered three edits later.
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
[ "$status" -eq 0 ] && exit 0

printf '%s' "$out" | node -e "
let s='';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  // tsc's own diagnostics, not the pnpm exit-status noise wrapped around them.
  const all = s.split('\n').filter((l) => l.trim());
  const errors = all.filter((l) => /error TS[0-9]+/.test(l));
  const lines = (errors.length ? errors : all).slice(0, 25).join('\n');
  process.stdout.write(JSON.stringify({
    systemMessage: 'pnpm typecheck failed after that edit',
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'pnpm typecheck failed after this edit:\n' + lines,
    },
  }));
});"
