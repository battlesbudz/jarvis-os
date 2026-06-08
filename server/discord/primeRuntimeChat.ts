import type { PrimeRuntimeInput, PrimeRuntimeResult } from "../agent/autonomyRuntime";

type PrimeRuntimeChatHandler = (input: PrimeRuntimeInput) => Promise<PrimeRuntimeResult>;

export async function tryHandleDiscordChatWithPrime(
  input: {
    userId: string;
    message: string;
    originChannelId?: string;
    guildId?: string;
  },
  handlePrime?: PrimeRuntimeChatHandler,
): Promise<string | null> {
  const runtime = handlePrime ?? (await import("../agent/autonomyRuntime")).handlePrimeInput;
  const result = await runtime({
    userId: input.userId,
    channel: "discord",
    message: input.message,
    metadata: {
      originChannelId: input.originChannelId,
      discordGuildId: input.guildId,
    },
  });

  if (!result.handled) return null;
  return result.reply ?? "PRIME handled that request, but did not return a displayable reply.";
}
