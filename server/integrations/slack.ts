export interface SlackMessage {
  channel: string;
  channelType: 'channel' | 'dm' | 'group';
  user: string;
  text: string;
  timestamp: string;
}

interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_im?: boolean;
  is_group?: boolean;
  is_mpim?: boolean;
  updated?: number;
}

interface SlackApiMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

async function slackApi(endpoint: string, accessToken: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error (${endpoint}): ${data.error || 'unknown'}`);
  }
  return data;
}

async function resolveUserNames(accessToken: string, userIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)];
  const nameMap: Record<string, string> = {};

  await Promise.all(
    unique.map(async (uid) => {
      try {
        const data = await slackApi('users.info', accessToken, { user: uid });
        const u = data.user;
        nameMap[uid] = u?.profile?.display_name || u?.real_name || u?.name || uid;
      } catch {
        nameMap[uid] = uid;
      }
    })
  );

  return nameMap;
}

export async function getSlackMessages(accessToken: string): Promise<SlackMessage[]> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

  const convData = await slackApi('conversations.list', accessToken, {
    types: 'public_channel,private_channel,im,mpim',
    exclude_archived: 'true',
    limit: '200',
  });

  const conversations: SlackConversation[] = convData.channels || [];

  const withActivity = conversations
    .filter(c => c.updated && c.updated > sevenDaysAgo)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .slice(0, 5);

  if (withActivity.length === 0) return [];

  const allMessages: SlackMessage[] = [];
  const userIdsToResolve: string[] = [];

  await Promise.all(
    withActivity.map(async (conv) => {
      try {
        const histData = await slackApi('conversations.history', accessToken, {
          channel: conv.id,
          oldest: sevenDaysAgo.toString(),
          limit: '30',
        });

        const msgs: SlackApiMessage[] = histData.messages || [];

        for (const msg of msgs) {
          if (msg.bot_id) continue;
          if (msg.subtype && msg.subtype !== 'me_message') continue;
          if (!msg.text || !msg.text.trim()) continue;
          if (!msg.ts) continue;

          const ts = parseFloat(msg.ts);
          if (ts < sevenDaysAgo) continue;

          if (msg.user) userIdsToResolve.push(msg.user);

          const channelType: SlackMessage['channelType'] =
            conv.is_im ? 'dm' :
            conv.is_group || conv.is_mpim ? 'group' :
            'channel';

          allMessages.push({
            channel: conv.name || conv.id,
            channelType,
            user: msg.user || 'unknown',
            text: msg.text.slice(0, 500),
            timestamp: new Date(ts * 1000).toISOString(),
          });
        }
      } catch (err) {
        console.error(`Failed to fetch history for channel ${conv.id}:`, err);
      }
    })
  );

  const nameMap = await resolveUserNames(accessToken, userIdsToResolve);

  for (const msg of allMessages) {
    if (nameMap[msg.user]) {
      msg.user = nameMap[msg.user];
    }
  }

  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return allMessages;
}
