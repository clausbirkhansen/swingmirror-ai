// Kopierer PeerJS fra node_modules til www/vendor, så appen ikke henter kode fra internettet.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
const src = 'node_modules/peerjs/dist/peerjs.min.js';
if (!existsSync(src)) { console.error('peerjs ikke installeret endnu – kør "npm install"'); process.exit(0); }
mkdirSync('www/vendor', { recursive: true });
copyFileSync(src, 'www/vendor/peerjs.min.js');
console.log('PeerJS kopieret til www/vendor/peerjs.min.js');
