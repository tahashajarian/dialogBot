require("dotenv").config();

const { Telegraf } = require("telegraf");
const connectDB = require("./db");
const { handleUpdate } = require("./bot");
const { getOrCreateUser } = require("./services/users");
const { beginInteraction } = require("./services/interaction-guard");
const DEFAULT_ALLOWED_USERNAMES = ["taha_shj"];

function resolveBaleApiRoot() {
  return (process.env.API_ROOT || "").trim() || null;
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function resolveAllowedUsernames() {
  const fromEnv = String(process.env.ALLOWED_USERNAMES || "").trim();
  const source = fromEnv ? fromEnv.split(",") : DEFAULT_ALLOWED_USERNAMES;
  const normalized = source
    .map((value) => normalizeUsername(value))
    .filter(Boolean);
  return new Set(normalized);
}

const ALLOWED_USERNAMES = resolveAllowedUsernames();

function isAllowedUser(from) {
  return ALLOWED_USERNAMES.has(normalizeUsername(from?.username));
}

const baleApiRoot = resolveBaleApiRoot();
const bot = new Telegraf(
  process.env.BOT_TOKEN,
  baleApiRoot
    ? {
      telegram: {
        apiRoot: baleApiRoot,
      },
    }
    : undefined,
);

bot.catch((err) => {
  console.error("Bot update error:", err);
});

function createAppContext(ctx, user) {
  const PIN_OPERATION_TIMEOUT_MS = 2500;
  const PIN_RETRY_DELAY_MS = 400;

  const resolveChatId = () => (
    ctx.chat?.id ||
    ctx.callbackQuery?.message?.chat?.id ||
    ctx.message?.chat?.id
  );

  const callTelegramApiWithTimeout = async (method, payload, timeoutMs) => {
    if (!ctx.telegram?.callApi) {
      return false;
    }

    const supportsAbortController = typeof AbortController !== "undefined";
    const abortController = supportsAbortController ? new AbortController() : null;
    const callPromise = ctx.telegram.callApi(
      method,
      payload,
      abortController ? { signal: abortController.signal } : undefined,
    );
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController?.abort();
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([callPromise, timeoutPromise]);
      return true;
    } finally {
      clearTimeout(timeoutId);
      callPromise.catch(() => {});
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getErrorCode = (error) => Number(
    error?.code ||
    error?.response?.error_code ||
    error?.response?.data?.error_code,
  );
  const getErrorDescription = (error) => (
    error?.description ||
    error?.response?.description ||
    error?.response?.data?.description
  );
  const getErrorText = (error) => (
    error?.message ||
    error?.response?.data?.error ||
    error
  );
  const isMessageNotFoundError = (error) => {
    const code = getErrorCode(error);
    const description = String(getErrorDescription(error) || "").toLowerCase();
    return code === 404 && description.includes("message not found");
  };
  const isRetriablePinError = (error) => {
    const code = getErrorCode(error);
    const text = String(error?.message || "").toLowerCase();
    return code === 500 || text.includes("internal server error") || text.includes("timed out");
  };

  return {
    user,
    userId: user?.userId,
    languageCode: ctx.from?.language_code,
    message: ctx.message,
    text: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,
    callbackMessageId: ctx.callbackQuery?.message?.message_id || ctx.callbackQuery?.message?.messageId,

    reply: (...args) => ctx.reply(...args),
    replyWithPhoto: (...args) => ctx.replyWithPhoto(...args),
    answerCb: (text) => ctx.answerCbQuery(text).catch(() => {}),
    sendToUser: async (userId, text, extra = {}) => {
      const targetUserId = Number(userId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !ctx.telegram?.callApi) {
        return false;
      }
      try {
        await callTelegramApiWithTimeout(
          "sendMessage",
          {
            chat_id: targetUserId,
            text,
            ...extra,
          },
          PIN_OPERATION_TIMEOUT_MS,
        );
        return true;
      } catch {
        return false;
      }
    },
    editMessage: (...args) => ctx.editMessageText(...args),
    editMessageText: async (messageId, text, extra = {}) => {
      const chatId = resolveChatId();
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await callTelegramApiWithTimeout(
          "editMessageText",
          {
            chat_id: chatId,
            message_id: normalizedMessageId,
            text,
            ...extra,
          },
          PIN_OPERATION_TIMEOUT_MS,
        );
      } catch (error) {
        if (isMessageNotFoundError(error)) {
          return false;
        }
        console.warn("Failed to edit bot message:", {
          chatId,
          messageId: normalizedMessageId,
          code: getErrorCode(error),
          description: getErrorDescription(error),
          error: getErrorText(error),
        });
        return false;
      }
    },
    deleteMessage: async (messageId) => {
      const chatId = resolveChatId();
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await callTelegramApiWithTimeout(
          "deleteMessage",
          {
            chat_id: chatId,
            message_id: normalizedMessageId,
          },
          PIN_OPERATION_TIMEOUT_MS,
        );
      } catch {
        return false;
      }
    },
    pinMessage: async (messageId) => {
      const chatId = resolveChatId();
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      let lastError = null;
      const pinPayloads = [
        {
          chat_id: chatId,
          message_id: normalizedMessageId,
        },
        {
          chat_id: String(chatId),
          message_id: String(normalizedMessageId),
        },
      ];

      for (let attempt = 0; attempt < pinPayloads.length; attempt += 1) {
        if (attempt > 0) {
          await sleep(PIN_RETRY_DELAY_MS);
        }

        try {
          return await callTelegramApiWithTimeout(
            "pinChatMessage",
            pinPayloads[attempt],
            PIN_OPERATION_TIMEOUT_MS,
          );
        } catch (error) {
          lastError = error;
          if (!isRetriablePinError(error) || attempt >= pinPayloads.length - 1) {
            break;
          }
        }
      }

      console.error("Failed to pin chat message:", {
        chatId,
        messageId: normalizedMessageId,
        code: getErrorCode(lastError),
        description: getErrorDescription(lastError),
        error: getErrorText(lastError),
      });
      return false;
    },
    unpinMessage: async (messageId) => {
      const chatId = resolveChatId();
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await callTelegramApiWithTimeout(
          "unpinChatMessage",
          {
            chat_id: chatId,
            message_id: normalizedMessageId,
          },
          PIN_OPERATION_TIMEOUT_MS,
        );
      } catch (error) {
        console.error("Failed to unpin chat message:", {
          chatId,
          messageId: normalizedMessageId,
          code: getErrorCode(error),
          description: getErrorDescription(error),
          error: getErrorText(error),
        });
        return false;
      }
    },
  };
}

async function processUpdate(ctx) {
  if (!isAllowedUser(ctx.from)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("go away it's not ready yet!").catch(() => {});
    }
    await ctx.reply("go away it's not ready yet!").catch(() => {});
    return;
  }

  const user = await getOrCreateUser(ctx.from);
  const appCtx = createAppContext(ctx, user);
  const interaction = beginInteraction({
    userId: user?.userId || ctx.from?.id,
    callbackData: appCtx.callbackData,
    text: appCtx.text,
    state: user?.state || "idle",
  });

  if (!interaction.allowed) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => {});
    }
    return;
  }

  try {
    return await handleUpdate(appCtx);
  } finally {
    interaction.finish();
  }
}

bot.on("message", processUpdate);
bot.on("callback_query", processUpdate);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, {
  attempts = 4,
  delayMs = 1500,
  onRetry = () => {},
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      onRetry(error, attempt, attempts);
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

(async () => {
  try {
    console.log("[startup] connecting database...");
    await connectDB();
    console.log("[startup] checking bot token/API via getMe...");
    await retry(
      () => bot.telegram.getMe(),
      {
        attempts: 5,
        delayMs: 2000,
        onRetry: (error, attempt, attempts) => {
          console.warn(
            `[startup] getMe failed (${attempt}/${attempts - 1} retries used):`,
            error?.message || error,
          );
        },
      },
    );
    console.log("[startup] getMe successful.");

    try {
      console.log("[startup] deleting webhook (polling mode)...");
      await bot.telegram.deleteWebhook();
    } catch (deleteWebhookError) {
      console.warn("deleteWebhook failed; continuing with polling mode.");
      console.warn(deleteWebhookError?.message || deleteWebhookError);
    }

    const pollingLoop = bot.startPolling();
    console.log("[startup] bot started in polling mode.");

    pollingLoop.catch((pollingError) => {
      console.error("Polling stopped with error:", pollingError);
      process.exit(1);
    });
  } catch (error) {
    console.error("Bot startup failed:", error);
    process.exit(1);
  }
})();
