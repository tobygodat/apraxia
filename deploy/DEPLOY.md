# Legacy VPS recovery

Historical instructions for the preserved Python runtime. These do not apply
to the current cloud app; use [cloud development](../docs/CLOUD_DEVELOPMENT.md).

## 1. VPS + user
- Rent a small VPS (~$6/mo, e.g. Hetzner CX22). 1 vCPU / 2 GB is plenty.
- Create a non-root user and `/opt/orbitos` owned by it:
  ```bash
  sudo adduser --system --group orbitos
  sudo mkdir -p /opt/orbitos && sudo chown orbitos:orbitos /opt/orbitos
  ```
- Install `git`, and `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`).
- Install Node (for the one-time SPA build) — e.g. via `nvm` or distro packages.

## 2. Vault git sync
- Make the Obsidian vault a **private** git repo; enable the Obsidian Git plugin
  with a ~10 min auto-commit interval; push.
- Clone it onto the VPS at the path you'll set as `VAULT_PATH` (e.g.
  `/opt/orbitos/vault`). The scheduled scan runs `git pull` (read-only input).

## 3. App
```bash
cd /opt/orbitos
git clone <this-repo> .
uv sync                     # creates .venv, installs the package
cd frontend && npm install && npm run build && cd ..   # emits frontend/dist
cp .env.example .env        # then edit — see below
```

## 4. Secrets
Fill `.env` (never commit it):
- `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` — @BotFather token; message the bot and
  grab your numeric chat id.
- `ANTHROPIC_API_KEY` — from the Anthropic console.
- `APP_PASSWORD` — the single web password; `SESSION_SECRET` — a long random string.
- `VAULT_PATH`, `DB_PATH`, and set `ENV=production` so FastAPI serves `frontend/dist`.

## 5. Run as a service
```bash
sudo cp deploy/orbitos.service /etc/systemd/system/orbitos.service
sudo systemctl daemon-reload
sudo systemctl enable --now orbitos
journalctl -u orbitos -f
```

## 6. Harden
- SSH keys only; disable password auth.
- Firewall: allow only SSH + the app port (`ufw allow OpenSSH`, `ufw allow <PORT>`).
- Put TLS in front (a reverse proxy such as Caddy/nginx) — the web app is on the
  public internet and the session cookie should travel over HTTPS.
- Keep the vault repo **private**.

## 7. Tune
After a few days of real notes, adjust `SCAN_INTERVAL_MIN` and
`CONFIDENCE_THRESHOLD` — the threshold trades auto-filing against how much gets
texted to you for approval.
