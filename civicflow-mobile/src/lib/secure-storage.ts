import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'civicflow.refreshToken';
const SELECTED_ORG_KEY = 'civicflow.selectedOrganizationId';

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
};
