#!/usr/bin/env node
/**
 * Serve the site locally with caching off (edits show up on reload).
 * Usage: npm run serve [-- --port 8000]
 */
import { startServer, parseArgs } from './lib/site.mjs';

const args = parseArgs(process.argv.slice(2), { port: '8000' });
const { url } = await startServer({ port: Number(args.port) });
console.log(`Serving the site at ${url} (Ctrl+C to stop)`);
