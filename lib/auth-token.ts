import AsyncStorage from "@react-native-async-storage/async-storage";

export const AUTH_TOKEN_KEY = "@gameplan_auth_token";

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}
