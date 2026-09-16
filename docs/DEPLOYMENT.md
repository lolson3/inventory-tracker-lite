# Deployment and recovery

This guide covers a Debian server accessed over a local network. For a local development setup, see the [README](../README.md).

## Configuration

Environment variables are read at startup; `.env` files are **not** loaded automatically.

| Variable        | Default     | Meaning                                                       |
| --------------- | ----------- | ------------------------------------------------------------- |
| `HOST`          | `127.0.0.1` | Listen address                                                |
| `PORT`          | `3001`      | Integer from 1 to 65535                                       |
| `DATA_DIR`      | `data`      | Writable data directory; use an absolute path in production   |
| `PUBLIC_ORIGIN` | unset       | Exact HTTPS origin, e.g. `https://inventory.example.internal` |

Non-loopback binding requires `PUBLIC_ORIGIN`. For normal LAN deployment, keep Node on loopback and expose an HTTPS reverse proxy. The tracker has no login; anyone who can reach it can view and edit inventory.

## Debian deployment

1. Install Node.js 24.15+ (24.x), npm, and an HTTPS reverse proxy such as Caddy. Verify the Node path with `command -v node`; adjust the supplied service units if it is not `/usr/bin/node`.
2. Copy the source to `/opt/inventory-tracker-lite`, then run `npm ci`, `npm test`, and `npm run build` as your deployment account. Keep source and build output owned by that account, not the runtime service account.
3. Create the service account and data directory:

   ```sh
   sudo useradd --system --home-dir /var/lib/inventory-tracker --shell /usr/sbin/nologin inventory
   sudo install -d -o inventory -g inventory -m 700 /var/lib/inventory-tracker
   ```

4. Copy your legacy JSON or restored database into that directory and give the `inventory` account ownership. Preserve a backup first.
5. Create `/etc/inventory-tracker.env` containing:

   ```ini
   PUBLIC_ORIGIN=https://inventory.example.internal
   ```

6. Install [inventory-tracker.service](../deploy/inventory-tracker.service) into `/etc/systemd/system/`. Configure Caddy using [Caddyfile](../deploy/Caddyfile), replacing the hostname in both configurations. Arrange local DNS and trust Caddy's internal CA on client devices. Allow HTTPS from the intended LAN clients; do not expose port 3001 through the firewall. `PUBLIC_ORIGIN` is a validation setting, not a TLS implementation.
7. Start the service:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now inventory-tracker.service
   sudo journalctl -u inventory-tracker.service -f
   ```

Open the HTTPS address to use the tracker. The service runs with restricted filesystem access, private temporary storage, and a restrictive file-creation mask. SIGTERM/SIGINT allow active requests to finish before closing storage.

## Backups and restore

Use the online SQLite backup API while the service is running:

```sh
DATA_DIR=/var/lib/inventory-tracker npm run backup -- /path/to/new-backup.sqlite
```

Run this as an account with access to the data directory. The destination must not exist. Omitting the destination creates a timestamped file under `backups/` relative to the working directory.

For daily backups, install [inventory-backup.service](../deploy/inventory-backup.service) and [inventory-backup.timer](../deploy/inventory-backup.timer) into `/etc/systemd/system/`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now inventory-backup.timer
```

These backups go into `/var/lib/inventory-backups/backups/`. Monitor free disk space and backup failures; set an appropriate retention policy and copy backups off the server. The application does not automatically delete old backups or request receipts.

Restore into a **new** directory; existing directories are refused:

```sh
npm run restore -- /path/to/backup.sqlite /path/to/restored-data
```

Stop the service, set the restored directory's ownership, and point `DATA_DIR` at it. If using the supplied systemd unit, also allow that directory with `ReadWritePaths=` or restore under its managed state directory. Start the service and verify inventory before retiring the old data. Tests exercise backup restoration, but periodically rehearse recovery on the deployed server too.

CSV export is intended for spreadsheets, not complete recovery. It neutralizes common spreadsheet formula prefixes; preserve barcode columns as text when importing to avoid losing leading zeros.

## Operational limits

The application accepts operation bodies up to 256 KiB, up to 250 scans per batch, 100,000 items, 1,000 item types, and 100 aliases per item. The server allows 1,200 total HTTP requests per minute per process. Configure client-specific limits at the proxy if needed. Responses and the frontend currently contain the full inventory; large installations will need pagination.

See [the follow-up audit](../AUDIT.md) for verification results and remaining limitations.
