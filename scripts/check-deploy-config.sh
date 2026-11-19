#!/usr/bin/env bash
# Names only: deployment values must never appear in logs.
set -euo pipefail
missing=()
for name in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS CARCHECK_ENV CARCHECK_URL; do
  if [[ ! "${!name-}" =~ [^[:space:]] ]]; then missing+=("$name"); fi
done
if ((${#missing[@]})); then
  message="Deployment is not configured. Set these secrets in the GitHub production environment: ${missing[*]}. See README \"Deploying\"."
  printf 'ready=false\n' >> "$GITHUB_OUTPUT"
  printf '%s\n' "$message" >> "$GITHUB_STEP_SUMMARY"
  if [[ "${1-}" == '--required' ]]; then
    printf '::error::%s\n' "$message"
    exit 1
  fi
  printf '::notice::%s Automatic deployment is skipped.\n' "$message"
else
  printf 'ready=true\n' >> "$GITHUB_OUTPUT"
fi
