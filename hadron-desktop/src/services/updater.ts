/**
 * Auto-updater service using tauri-plugin-updater
 *
 * Provides update checking and installation functionality
 * for Hadron desktop application.
 */

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  date?: string;
  body?: string;
}

/**
 * Check for available updates
 *
 * @returns Update information including availability and version details
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const update = await check();

    if (update) {
      console.log(
        `✨ Update available: ${update.version} (current: ${update.currentVersion})`
      );

      return {
        available: true,
        currentVersion: update.currentVersion,
        latestVersion: update.version,
        date: update.date,
        body: update.body,
      };
    } else {
      console.log('✅ App is up to date');

      return {
        available: false,
        currentVersion: '1.0.0', // Fallback to package version
      };
    }
  } catch (error) {
    console.error('❌ Failed to check for updates:', error);
    throw new Error(`Update check failed: ${error}`);
  }
}

/**
 * Download and install an available update
 *
 * @param onProgress - Optional callback for download progress (0-100)
 * @returns Promise that resolves when download is complete
 */
export async function downloadAndInstall(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  try {
    const update = await check();

    if (!update) {
      throw new Error('No updates available');
    }

    console.log('📥 Downloading update...');

    // Download with progress tracking
    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          console.log(`📦 Download started: ${contentLength} bytes`);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          const progress = Math.round((downloaded / contentLength) * 100);
          console.log(`⬇️  Progress: ${progress}%`);
          if (onProgress) {
            onProgress(downloaded, contentLength);
          }
          break;
        case 'Finished':
          console.log('✅ Download complete');
          break;
      }
    });

    console.log('🎉 Update installed successfully');
  } catch (error) {
    console.error('❌ Failed to download and install update:', error);
    throw new Error(`Update installation failed: ${error}`);
  }
}

/**
 * Restart the application to apply updates
 *
 * Note: Only call this after downloadAndInstall() succeeds
 */
export async function restartApp(): Promise<void> {
  console.log('🔄 Restarting application...');
  await relaunch();
}

/**
 * Check for updates and prompt user with dialog
 *
 * @returns True if update was installed and app needs restart
 */
export async function checkAndUpdate(): Promise<boolean> {
  try {
    const updateInfo = await checkForUpdates();

    if (!updateInfo.available) {
      return false;
    }

    // Since dialog: true is set in tauri.conf.json,
    // Tauri will automatically show update dialog
    console.log('💬 Update dialog shown to user');

    return true;
  } catch (error) {
    console.error('❌ Auto-update failed:', error);
    return false;
  }
}
