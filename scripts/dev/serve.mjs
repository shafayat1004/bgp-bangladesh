#!/usr/bin/env node
/**
 * Serve the site locally with caching off (edits show up on reload).
 * Usage: npm run serve [-- --port 8000] [-- --lan]   (or PORT=8010 LAN=1 npm run serve)
 *
 * --lan also listens on the local network so a phone on the same Wi-Fi can
 * open it. It serves the whole repo folder, so only use it on a network you trust.
 */
import os from 'node:os';
import { startServer, parseArgs } from './lib/site.mjs';

const argv = process.argv.slice(2);
const lan = argv.includes('--lan') || !!process.env.LAN;
const args = parseArgs(argv.filter(a => a !== '--lan'), { port: process.env.PORT || '8000' });
const { url } = await startServer({ port: Number(args.port), host: lan ? '::' : 'localhost' });
console.log(`Serving the site at ${url} (Ctrl+C to stop)`);
if (lan) {
  const port = new URL(url).port;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`On your local network: http://${a.address}:${port}/`);
    }
  }
}
