/**
 * Configuration Utilities
 * Centralized helpers for reading/writing app configuration from localStorage
 */

/**
 * Get a boolean setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist (default: false)
 * @returns The boolean value
 */
export function getBooleanSetting(key: string, defaultValue: boolean = false): boolean {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  return value === "true";
}

/**
 * Set a boolean setting in localStorage
 * @param key - The localStorage key
 * @param value - The boolean value to store
 */
export function setBooleanSetting(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

/**
 * Get a string setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist
 * @returns The string value or default
 */
export function getStringSetting(key: string, defaultValue: string = ""): string {
  return localStorage.getItem(key) || defaultValue;
}

/**
 * Get a numeric setting from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist or invalid
 * @returns The numeric value or default
 */
export function getNumericSetting(key: string, defaultValue: number): number {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a JSON object from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Default value if key doesn't exist or invalid JSON
 * @returns The parsed object or default
 */
export function getJSONSetting<T>(key: string, defaultValue: T): T {
  const value = localStorage.getItem(key);
  if (value === null) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a JSON object in localStorage
 * @param key - The localStorage key
 * @param value - The object to serialize and store
 */
export function setJSONSetting<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
