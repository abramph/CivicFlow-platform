import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'civicflow.refreshToken';
const SELECTED_ORG_KEY = 'civicflow.selectedOrganizationId';
const USER_KEY = 'civicflow.user';

// expo-secure-store has no native backing on web, so fall back to
// localStorage there instead of crashing on every SecureStore call.
const webStorage = {
  getItemAsync: async (key: string) => window.localStorage.getItem(key),
  setItemAsync: async (key: string, value: string) => window.localStorage.setItem(key, value),
  deleteItemAsync: async (key: string) => window.localStorage.removeItem(key),
};

const storage = Platform.OS === 'web' ? webStorage : SecureStore;

export const secureStorage = {
  getRefreshToken: () => storage.getItemAsync(REFRESH_TOKEN_KEY),
  setRefreshToken: (value: string) => storage.setItemAsync(REFRESH_TOKEN_KEY, value),
  clearRefreshToken: () => storage.deleteItemAsync(REFRESH_TOKEN_KEY),

  getSelectedOrganizationId: () => storage.getItemAsync(SELECTED_ORG_KEY),
  setSelectedOrganizationId: (value: string) => storage.setItemAsync(SELECTED_ORG_KEY, value),
  clearSelectedOrganizationId: () => storage.deleteItemAsync(SELECTED_ORG_KEY),

  // Cached alongside the refresh token so a silent session restore (app
  // relaunch with no fresh login) can still show the signed-in user's
  // name/email -- there's no dedicated "current user" endpoint, and every
  // other mobile identity endpoint (profile, pta/profile) requires a
  // personal member identity an org owner/admin may not have.
  getUser: async <T,>(): Promise<T | null> => {
    const raw = await storage.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  setUser: (value: unknown) => storage.setItemAsync(USER_KEY, JSON.stringify(value)),
  clearUser: () => storage.deleteItemAsync(USER_KEY),
};
