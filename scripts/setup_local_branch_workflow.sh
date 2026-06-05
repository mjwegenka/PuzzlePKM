#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config --local push.default simple
git config --local remote.origin.push refs/heads/main:refs/heads/main

for branch_name in dev ios; do
  if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
    if git rev-parse --abbrev-ref --symbolic-full-name "${branch_name}@{upstream}" >/dev/null 2>&1; then
      git branch --unset-upstream "$branch_name"
    fi
  fi
done

hook_path="$repo_root/.git/hooks/pre-push"
cat >"$hook_path" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail

while read -r local_ref _remote_sha _remote_ref _remote_sha2; do
  if [[ "$local_ref" == "refs/heads/dev" || "$local_ref" == "refs/heads/ios" ]]; then
    echo "Push blocked: ${local_ref#refs/heads/} is local-only."
    exit 1
  fi
done
HOOK

chmod +x "$hook_path"
echo "Configured local-only dev/ios workflow and installed pre-push guard."
