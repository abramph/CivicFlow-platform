import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'civicflow.refreshToken';
const SELECTED_ORG_KEY = 'civicflow.selectedOrganizationId';

export const secureStorage = {
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  setRefreshToken: (value: string) => SecureStore.setItemAsync(REFRESH_TOKEN_KEY, value),
  clearRefreshToken: () => SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),

  getSelectedOrganizationId: () => SecureStore.getItemAsync(SELECTED_ORG_KEY),
  setSelectedOrganizationId: (value: string) => SecureStore.setItemAsync(SELECTED_ORG_KEY, value),
  clearSelectedOrganizationId: () => SecureStore.deleteItemAsync(SELECTED_ORG_KEY),
};
