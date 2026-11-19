# MW4Trackstats Workspace Rules

## Automatic GitHub Sync After Changes
- After completing and verifying any repository change (build, typecheck, and relevant tests passing), automatically stage only the intended changed files, commit them, and push to `origin main`.
- Use **English Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `perf:`, `style:`) with:
  1. A concise imperative subject line (`<type>: <what changed>`).
  2. A blank line followed by a clear commit body explaining **why** the change was made (the root cause, user goal, or problem solved).
- Inspect `git status --short` and `git diff --cached --stat` before committing to ensure no unrelated or sensitive files are included.

## Security & Public Repository Guardrails
- This repository is **public**. NEVER stage, commit, push, or print secrets from `.env`, private keys (`*.key`, `*.pem`), OAuth tokens, API keys, or runtime files in `server/data/`.
- Do not modify `.gitignore` to expose `.env`, `server/data/`, or key files.

## Production Deployment Policy
- Pushing to GitHub does **not** trigger automatic deployment to the Oracle Cloud server (`mw4stats.duckdns.org`).
- Only deploy or update the live Oracle Cloud server when the user explicitly asks to deploy/update the live site.
