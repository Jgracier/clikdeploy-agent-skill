import { execSync } from 'child_process';
import os from 'os';

console.log('=== ClikDeploy Skill Setup (Cross-Platform) ===');

const isWindows = os.platform() === 'win32';

try {
    if (isWindows) {
        console.log('Detected Windows. Running PowerShell installer...');
        execSync('powershell -Command "iex (iwr https://clikdeploy.com/cli.ps1).Content"', { stdio: 'inherit' });
    } else {
        console.log('Detected Unix (Linux/macOS). Running Bash installer...');
        execSync('curl -fsSL https://clikdeploy.com/cli.sh | bash', { stdio: 'inherit' });
    }

    console.log('\nInstalling Skill dependencies...');
    execSync('npm install', { stdio: 'inherit' });

    console.log('\n=== Setup Complete ===');
    console.log('Everything is ready. Run: clikdeploy login --exchange <CODE>');
} catch (error) {
    console.error('\nSetup failed:', error.message);
    process.exit(1);
}
