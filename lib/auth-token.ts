import AsyncStorage from "@react-native-async-storage/async-storage";

export const AUTH_TOKEN_KEY = "@gameplan_auth_token";
const AUTH_USER_ID_KEY = "@gameplan_auth_user_id";
const AUTH_USERNAME_KEY = "@gameplan_auth_username";
const AUTH_USER_EMAIL_KEY = "@gameplan_auth_user_email";

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function clearAuthStorage(): Promise<void> {
  await AsyncStorage.multiRemove([
    AUTH_TOKEN_KEY,
    AUTH_USER_ID_KEY,
    AUTH_USERNAME_KEY,
    AUTH_USER_EMAIL_KEY,
  ]);
}
