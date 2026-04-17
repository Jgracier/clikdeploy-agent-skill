import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

console.log('=== ClikDeploy Skill Setup (Cross-Platform) ===');

const isWindows = os.platform() === 'win32';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_CLI_TARBALL = path.join(__dirname, 'vendor', 'cli', 'clikdeploy-cli-1.0.3.tgz');

function installBundledCli() {
    if (!fs.existsSync(BUNDLED_CLI_TARBALL)) {
        throw new Error(`Bundled CLI tarball not found at ${BUNDLED_CLI_TARBALL}`);
    }

    console.log(`Installing bundled ClikDeploy CLI from ${BUNDLED_CLI_TARBALL}...`);
    execSync(`npm install -g "${BUNDLED_CLI_TARBALL}"`, { stdio: 'inherit' });
}

try {
    console.log(`Detected ${isWindows ? 'Windows' : 'Unix'}.`);
    installBundledCli();

    // Avoid recursive npm install when setup runs as postinstall.
    if (process.env.npm_lifecycle_event !== 'postinstall') {
        console.log('\nInstalling Skill dependencies...');
        execSync('npm install', { stdio: 'inherit' });
    }

    console.log('\n=== Setup Complete ===');
    console.log('Everything is ready. Run: clikdeploy login --exchange <CODE>');
} catch (error) {
    console.error('\nSetup failed:', error.message);
    process.exit(1);
}
