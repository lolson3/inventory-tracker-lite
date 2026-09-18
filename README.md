# Inventory Tracker Lite

A small inventory tracker for scanning barcodes, managing stock counts, and linking multiple barcodes to the same item. It runs on a local computer or a private network server and stores inventory in SQLite.

Built with TypeScript, Node.js, and a browser frontend. No separate database server or frontend framework is required.

## Features

- **Scan in batches:** collect additions or removals in a live list, then apply the batch with Enter or Done.
- **Linked barcodes:** multiple barcodes can share one item and stock count.
- **Item management:** edit descriptions and quantities, assign item types, and remove items or barcode links.
- **Filtering and sorting:** filter by item type or sort by name or quantity from the table headers.
- **CSV import and export:** download inventory for use in spreadsheets or replace it from an exported CSV.
- **Reliable saves:** transactional storage, conflict detection, and safe retries protect against lost updates and duplicate scans.
- **Local or LAN access:** localhost by default, with HTTPS proxy configuration for a private network.
- **Light and dark themes:** switch themes from the header and keep the preference between visits.

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

Open **http://127.0.0.1:5174**. Stop the server with `Ctrl+C`.

After building, you can also use the platform launcher:

| Platform       | Command             |
| -------------- | ------------------- |
| Windows        | `.\bin\start.bat`   |
| Debian / Linux | `sh ./bin/start.sh` |

The launchers resolve their own working directory and load an optional `.env` file from the project root. Variables already set in the shell or service take precedence. They start the compiled application; run `npm run build` again after changing source files.

## Using the app

1. Wait for inventory to load. Editing stays disabled if loading fails; refresh the page to retry.
2. Choose **Add** on the left or **Remove** on the right. Scan continuously into the overlay; each scan appears in the list. Press **Enter** or select **Done** to save the entire batch.
3. Use the pencil button to edit a description; quantities and item types can be changed directly in the table.
4. Open the item’s barcode dropdown and choose **+ Link barcode**. Scan into the overlay; a scanner’s Enter suffix submits the link automatically. You can also enter a barcode and select **Link barcode**.
5. Filter or sort the list from the Name and Quantity headers. Use **Export CSV** to download it or **Import CSV** to replace the inventory from an exported file.

The batch scanner expects no Enter suffix: a 150 ms input pause separates scans. Leave at least that pause between scans; paste complete barcodes for manual entry. Batches hold up to 250 scans. Each Add scan adds one unit, creating an item for an unknown barcode. Each Remove scan subtracts one unit; zero-stock items remain listed. Unknown barcodes or insufficient stock reject the entire removal batch. Use × to discard an incorrect scan, or Cancel to discard the session. Nothing changes until Done or Enter.

If a save fails, keep the page open and use **Retry save**. The request keeps its ID so a retry cannot apply the same change twice. If another browser has changed the inventory, conflicting edits are rejected; note your change, then refresh the page and review before applying it again.

## Data and backups

Inventory is stored in `data/inventory.sqlite` by default. Set `DATA_DIR` to use another directory; an absolute path is recommended for a server deployment. Runtime data and backups are excluded from Git.

An existing `inventory.json` in the data directory is validated and imported when the SQLite database is first initialized. Import runs in a transaction and leaves the JSON unchanged. After verifying the migration and a SQLite backup, the legacy JSON can be removed. Once initialized, the app reads and writes only SQLite.

Create a consistent backup, including while the app is running:

```sh
npm run backup
```

This creates a timestamped SQLite backup under `data/backups/`. Restore a backup into a new directory:

```sh
npm run restore -- data/backups/your-backup.sqlite restored-data
```

Stop the app before switching `DATA_DIR` to the restored directory. Do not copy only the main database file while the app is running; committed changes may still be in its SQLite journal. CSV exports are not a complete backup.

## Hosting on Debian

The default listen address is `127.0.0.1`, so the app is accessible only from the server itself. Containers set `HOST=0.0.0.0` and can be reached directly on the trusted LAN without `PUBLIC_ORIGIN`. When using an HTTPS reverse proxy, set `PUBLIC_ORIGIN` to its public origin to enforce that host and origin and enable HSTS.

The tracker has no login. Anyone who can reach the configured address can view and edit inventory, so keep it on a trusted network or protect it at the reverse proxy.

The app allows iframe embedding by default. To restrict it to one dashboard, set `EMBED_ORIGIN` to the dashboard's exact origin, including its scheme and non-default port when applicable, such as `http://dashboard.example.internal:8080`. The inventory app continues to listen on port `5174` by default.

### Docker Compose

The Compose configuration at `ops/docker/compose.yaml` persists the SQLite database and its backups in one named volume and binds the service to localhost by default. Start it directly for local HTTP access:

```sh
docker compose -f ops/docker/compose.yaml up -d --build
```

To place it behind HTTPS, set the proxy origin when starting:

```sh
PUBLIC_ORIGIN=https://inventory.example.internal docker compose -f ops/docker/compose.yaml up -d --build
```

For a Debian host using systemd directly, install Node.js 24.15+ and run `npm ci && npm run build`, then use `sh ./bin/start.sh`. Keep `data/` on persistent storage and schedule `npm run backup`. Example Caddy and systemd files live under `ops/`.

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
src/client/               Browser entry point and state controller
src/client/components/    Interactive UI modules
src/client/utils/         Browser utilities such as CSV handling
src/server/               HTTP server, configuration, validation, and storage
src/cli/                  Backup and restore commands
public/                   index.html, styles, and images
tests/                    API, storage, concurrency, recovery, and DOM tests
bin/                      Windows and Unix launchers
ops/docker/               Container build configuration
ops/caddy/                HTTPS reverse-proxy example
ops/systemd/              Debian service and backup timer examples
ops/docker/compose.yaml   Local container deployment
data/                     Runtime database and backups; excluded from Git
```

The test suite uses temporary databases and local test servers. It covers migration, concurrent writes, stale edits, retry behavior, validation, request limits, frontend failure states, and backup recovery. Debian deployment and real-device scanning still need validation on the target server and devices.

## License

See [LICENSE](LICENSE).
