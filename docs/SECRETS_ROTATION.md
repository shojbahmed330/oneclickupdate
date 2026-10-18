# Secrets Rotation Runbook

How to rotate every secret used by OneClick Studio. Do this every 90 days, or
immediately if a secret is suspected leaked (commit, log paste, ex-employee).

---

## 1. `GITHUB_WEBHOOK_SECRET` (build callback HMAC)

Used by `trigger-build` → GitHub Action → `build-webhook` to authenticate
build progress callbacks. Both sides must match exactly.

**Steps:**
1. Generate a new random secret (≥32 chars):
   ```bash
   openssl rand -hex 32
   ```
2. **Lovable Cloud** → Project secrets → update `GITHUB_WEBHOOK_SECRET` with
   the new value (do **not** delete first — replace in place to avoid
   in-flight builds failing mid-run).
3. Wait until any in-flight builds finish (check `app_builds` table for
   `status = 'running'`).
4. The new secret is automatically passed to GitHub Actions on the next
   `trigger-build` call as a workflow input — no GitHub-side change needed.

**Blast radius if leaked:** an attacker can forge build status callbacks and
mark arbitrary builds as failed/succeeded. They cannot trigger new builds.

---

## 2. `GITHUB_BUILD_PAT` (GitHub Personal Access Token)

Used by `trigger-build` to dispatch the `build-apk.yml` workflow.

**Steps:**
1. Go to GitHub → Settings → Developer settings → Personal access tokens
   (fine-grained) → regenerate the token bound to the build repo.
   Required scopes: **Actions: Read & Write**, **Contents: Read**.
2. Update `GITHUB_BUILD_PAT` in Lovable Cloud secrets.
3. Trigger a test build to verify dispatch works.

**Blast radius if leaked:** an attacker can run/cancel any workflow in the
build repo and read its source.

---

## 3. `KEYSTORE_ENCRYPTION_KEY` (user keystore AES key)

⚠️ **DO NOT ROTATE casually.** This key encrypts every user's `.jks` keystore
in the database. Rotating it without re-encrypting existing rows will lock
every user out of releasing new versions of their app forever (Play Store
requires the same signing key for every update).

**If rotation is required (suspected compromise):**
1. Generate the new key.
2. Write a one-shot migration script that, for every row in
   `user_keystores`, decrypts with the old key and re-encrypts with the new
   key in a single transaction.
3. Only after every row is migrated, swap `KEYSTORE_ENCRYPTION_KEY` in
   secrets. Keep the old key available as `KEYSTORE_ENCRYPTION_KEY_OLD`
   for at least 30 days as a rollback.

---

## 4. `LOVABLE_API_KEY` (AI Gateway)

Use the Lovable rotate tool — never edit manually. From the agent:
`lovable_api_key--rotate_lovable_api_key`. Or in the dashboard:
Project → AI → Rotate key.

---

## 5. `DAYTONA_API_KEY` (sandbox provider)

1. Daytona dashboard → API keys → revoke + create new.
2. Update `DAYTONA_API_KEY` in Lovable Cloud secrets.
3. New sandboxes will use the new key immediately. Existing sandboxes keep
   running on their session token until they auto-stop.

---

## 6. `SENTRY_DSN` (error tracking)

DSNs are not strictly secret (they go into the client bundle), but rotate if
you suspect abuse:
1. Sentry → Project settings → Client Keys → revoke + create new.
2. Update `SENTRY_DSN` in Lovable Cloud secrets.
3. Frontend picks it up on the next page load via `sentry-config` edge fn.

---

## 7. Supabase service-role + anon keys

Use `supabase--rotate_api_keys` agent tool, or in the Lovable Cloud UI:
Project → API → Rotate. Both edge functions and the frontend client refresh
automatically.

---

## Quarterly rotation checklist

- [ ] `GITHUB_WEBHOOK_SECRET`
- [ ] `GITHUB_BUILD_PAT`
- [ ] `DAYTONA_API_KEY`
- [ ] `LOVABLE_API_KEY`
- [ ] Audit `secrets` table for unused / orphaned entries
- [ ] Verify last keystore backup exists before touching `KEYSTORE_ENCRYPTION_KEY`
