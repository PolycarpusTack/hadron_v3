/**
 * Auto-updater service using tauri-plugin-updater
 *
 * Provides update checking and installation functionality
 * for Hadron desktop application.
 */

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import logger from './logger';

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
      logger.info('Update available', { version: update.version, currentVersion: update.currentVersion, source: 'updater', category: 'system' });

      return {
        available: true,
        currentVersion: update.currentVersion,
        latestVersion: update.version,
        date: update.date,
        body: update.body,
      };
    } else {
      logger.info('App is up to date', { source: 'updater', category: 'system' });

      return {
        available: false,
        // Note: When no update is available, we don't have access to currentVersion
        // from the check() response, so we indicate unknown. The UI should handle this.
        currentVersion: 'unknown',
      };
    }
  } catch (error) {
    logger.error('Failed to check for updates', { error: String(error), source: 'updater', category: 'system' });
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

    logger.info('Downloading update', { source: 'updater', category: 'system' });

    // Download with progress tracking
    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          logger.info('Download started', { contentLength, source: 'updater', category: 'system' });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          // SECURITY: Guard against division by zero when contentLength is 0 or unknown
          const progress = contentLength > 0
            ? Math.round((downloaded / contentLength) * 100)
            : 0;
          logger.debug('Download progress', { progress, source: 'updater', category: 'system' });
          if (onProgress) {
            onProgress(downloaded, contentLength);
          }
          break;
        case 'Finished':
          logger.info('Download complete', { source: 'updater', category: 'system' });
          break;
      }
    });

    logger.info('Update installed successfully', { source: 'updater', category: 'system' });
  } catch (error) {
    logger.error('Failed to download and install update', { error: String(error), source: 'updater', category: 'system' });
    throw new Error(`Update installation failed: ${error}`);
  }
}

/**
 * Restart the application to apply updates
 *
 * Note: Only call this after downloadAndInstall() succeeds
 */
export async function restartApp(): Promise<void> {
  logger.info('Restarting application', { source: 'updater', category: 'system' });
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
    logger.info('Update dialog shown to user', { source: 'updater', category: 'system' });

    return true;
  } catch (error) {
    logger.error('Auto-update failed', { error: String(error), source: 'updater', category: 'system' });
    return false;
  }
}
