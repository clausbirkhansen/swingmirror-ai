// Tilføjer de tilladelser appen skal bruge til de native projekter (idempotent – kan køres flere gange).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let x = readFileSync(plist, 'utf8');
  const keys = {
    NSCameraUsageDescription: 'SwingMirror uses the camera to record your golf swing and send it live to your other device.',
    NSPhotoLibraryAddUsageDescription: 'SwingMirror saves the swing recordings you choose to keep to your photo library.',
    UIUserInterfaceStyle: 'Dark',
    NSLocalNetworkUsageDescription: 'SwingMirror uses the local network to connect the camera and viewer devices directly.',
  };
  let changed = false;
  for (const [k, v] of Object.entries(keys)) {
    if (!x.includes(`<key>${k}</key>`)) { x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t<string>${v}</string>\n</dict>\n</plist>\n`); changed = true; }
  }
  // Appen bruger kun standard-kryptering (WebRTC/HTTPS) -> springer eksportspørgsmålet over ved hver upload
  if (!x.includes('<key>ITSAppUsesNonExemptEncryption</key>')) { x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>\n</plist>\n`); changed = true; }
  if (changed) { writeFileSync(plist, x); console.log('iOS Info.plist opdateret'); } else console.log('iOS Info.plist var allerede opdateret');
} else console.log('Ingen iOS-mappe endnu (springer over)');

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  const lines = [
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
  ];
  let changed = false;
  for (const l of lines) {
    const key = l.match(/android:name="([^"]+)"/)[1];
    if (!x.includes(key)) { x = x.replace('</manifest>', `    ${l}\n</manifest>`); changed = true; }
  }
  if (changed) { writeFileSync(manifest, x); console.log('AndroidManifest.xml opdateret'); } else console.log('AndroidManifest.xml var allerede opdateret');
} else console.log('Ingen Android-mappe endnu (springer over)');
