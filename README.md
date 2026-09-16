# Inventory Tracker Lite

A small inventory tracker for scanning barcodes, managing stock counts, and linking multiple barcodes to the same item. It runs on a local computer or a private network server and stores inventory in SQLite.

Built with TypeScript, Node.js, and a browser frontend. No separate database server or frontend framework is required.

## Features

- **Scan in batches:** collect additions or removals in a live list, then apply the batch with Enter or Done.
- **Linked barcodes:** multiple barcodes can share one item and stock count.
- **Item management:** edit descriptions and quantities, assign item types, and remove items or barcode links.
- **Filtering and sorting:** filter by item type or sort by quantity.
- **CSV export:** download inventory for use in spreadsheets.
- **Reliable saves:** transactional storage, conflict detection, and safe retries protect against lost updates and duplicate scans.
- **Local or LAN access:** localhost by default, with HTTPS proxy configuration for a private network.

## Requirements

- **Node.js 24.15 or newer within the 24.x release line**
- **npm** to install development dependencies and build the app
- A modern browser

SQLite is included with Node.js. The compiled server has no production npm dependencies.

## Quick start

From the project directory:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Stop the server with `Ctrl+C`.

After building, you can also use the platform launcher:

| Platform       | Command         |
| -------------- | --------------- |
| Windows        | `.\start.bat`   |
| Debian / Linux | `sh ./start.sh` |

The launchers resolve their own working directory. They start the compiled application; run `npm run build` again after changing source files.

## Using the app

1. Wait for inventory to load. Editing stays disabled if loading fails; refresh the page to retry.
2. Choose **Add** on the left or **Remove** on the right. Scan continuously into the overlay; each scan appears in the list. Press **Enter** or select **Done** to save the entire batch.
3. Use the pencil button to edit a description; quantities and item types can be changed directly in the table.
4. Open the item’s barcode dropdown and choose **+ Link barcode**. Scan into the overlay; a scanner’s Enter suffix submits the link automatically. You can also enter a barcode and select **Link barcode**.
5. Filter or sort the list, or select **Export CSV** to download it.

The batch scanner expects no Enter suffix: a 150 ms input pause separates scans. Leave at least that pause between scans; paste complete barcodes for manual entry. Batches hold up to 250 scans. Each Add scan adds one unit, creating an item for an unknown barcode. Each Remove scan subtracts one unit; zero-stock items remain listed. Unknown barcodes or insufficient stock reject the entire removal batch. Use × to discard an incorrect scan, or Cancel to discard the session. Nothing changes until Done or Enter.

If a save fails, keep the page open and use **Retry save**. The request keeps its ID so a retry cannot apply the same change twice. If another browser has changed the inventory, conflicting edits are rejected; note your change, then refresh the page and review before applying it again.

## Data and backups

Inventory is stored in `data/inventory.sqlite` by default. Set `DATA_DIR` to use another directory; an absolute path is recommended for a server deployment. Runtime data and backups are excluded from Git.

An existing `inventory.json` in the data directory is validated and imported when the SQLite database is first initialized. Import runs in a transaction and leaves the JSON unchanged. After verifying the migration and a SQLite backup, the legacy JSON can be removed. Once initialized, the app reads and writes only SQLite.

Create a consistent backup, including while the app is running:

```sh
npm run backup
```

This creates a timestamped SQLite backup under `backups/`. Restore a backup into a new directory:

```sh
npm run restore -- backups/your-backup.sqlite restored-data
```

Stop the app before switching `DATA_DIR` to the restored directory. Do not copy only the main database file while the app is running; committed changes may still be in its SQLite journal. CSV exports are not a complete backup.

For scheduled backups, custom paths, and recovery procedures, see the [deployment guide](docs/DEPLOYMENT.md#backups-and-restore).

## Hosting on Debian

The default listen address is `127.0.0.1`, so the app is accessible only from the server itself. For LAN access, use an HTTPS reverse proxy.

The [deployment guide](docs/DEPLOYMENT.md) covers:

- Environment variables and data-directory configuration
- A dedicated service account and systemd service
- HTTPS access through Caddy
- Daily backups and restore procedures

Example configuration files are in [`deploy/`](deploy/). The tracker opens without a login. Anyone who can reach it can view and edit inventory.

## Development

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run build`        | Compile server and frontend TypeScript into `dist/`              |
| `npm start`            | Run the compiled server                                          |
| `npm run dev`          | Build once, then restart the server when compiled output changes |
| `npm test`             | Build and run the regression suite                               |
| `npm run typecheck`    | Check TypeScript without generating output                       |
| `npm run format`       | Format supported project files with Prettier                     |
| `npm run format:check` | Check formatting without changing files                          |
| `npm audit`            | Check installed dependencies for known vulnerabilities           |

For continuous compilation, run `npx tsc --watch` in a second terminal alongside `npm run dev`.

### Project layout

```text
client/                  Frontend behavior, save state, and CSV export
src/                     HTTP handling, configuration, validation, and storage
scripts/                 Backup and restore commands
tests/                   API, storage, concurrency, recovery, and DOM tests
deploy/                  Debian service and HTTPS proxy examples
docs/                    Deployment and recovery guide
server.ts                Server entry point
inventory_program.html   Page structure
styles.css               Page styling
```

Tests use temporary databases and local test servers. They cover migration, concurrent writes, stale edits, retry behavior, validation, access controls, request limits, frontend failure states, and backup recovery. GitHub Actions is configured to run checks on Windows and Linux.

See [AUDIT.md](AUDIT.md) for the latest local verification results and remaining limitations. Debian deployment and real-device scanning still need validation on the target server and devices.

## License

See [LICENSE](LICENSE).
