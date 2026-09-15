# Inventory Tracker Lite

A small barcode inventory frontend backed by a local Node/TypeScript server.

```powershell
npm install
npm run dev
```

Open http://localhost:3001 on the server computer, or `http://<server-ip>:3001` from another device on the local network. The server listens on `0.0.0.0`, and inventory and item types are stored in `data/inventory.json`.

For a compiled run, use `npm run build` followed by `npm start`.

## Startup scripts

Run `start.bat` on Windows or `sh ./start.sh` on Debian/Linux. Both launchers
check for Node.js and npm, install dependencies when missing or when the lockfile
is newer, build the TypeScript server, and start it in the foreground. Build tools
are installed even when `NODE_ENV=production`. Stop the server with Ctrl+C.

### Moving to Debian

1. Install Node.js 22 or newer and npm, and make sure both are in `PATH`.
2. Copy this project to the server, including `package-lock.json`, `server.ts`,
   `tsconfig.json`, `inventory_program.html`, and `styles.css`. Copy
   `data/inventory.json` to retain your inventory. Leave out `node_modules` and
   `dist`; the launcher installs and builds them on the server.
3. Give the account running the app write access to the project and `data`
   directory. The first launch needs network access to download dependencies.
4. Start the app:

   ```sh
   cd /path/to/inventory-tracker-lite
   sh ./start.sh
   ```

Open `http://<server-ip>:3001`. Allow the chosen TCP port through the server's
firewall for devices that need access. To choose another port, run
`PORT=8080 sh ./start.sh`.

The launcher can also be called by a service manager using
`/bin/sh /path/to/inventory-tracker-lite/start.sh`; it resolves its own working
directory. For automatic startup after reboot, configure the service manager to
run it as the account that owns the project. Back up `data/inventory.json` to
preserve inventory and item types.
