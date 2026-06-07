import { google } from "googleapis";

export async function getGmailClient(userAccessToken?: string | null) {
  if (!userAccessToken) throw new Error("Gmail user OAuth token is required");
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: userAccessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function getUncachableGmailClient(userAccessToken?: string | null) {
  return getGmailClient(userAccessToken);
}
