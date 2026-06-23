const DEFAULT_API_OPERATION_TIMEOUT_MS = 2500;
const PIN_RETRY_DELAY_MS = 400;
const { logger } = require("./logger");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return Number(
    error?.code ||
    error?.response?.error_code ||
    error?.response?.data?.error_code,
  );
}

function getErrorDescription(error) {
  return (
    error?.description ||
    error?.response?.description ||
    error?.response?.data?.description
  );
}

function getErrorText(error) {
  return (
    error?.message ||
    error?.response?.data?.error ||
    error
  );
}

function isMessageNotFoundError(error) {
  const code = getErrorCode(error);
  const description = String(getErrorDescription(error) || "").toLowerCase();
  return code === 404 && description.includes("message not found");
}

function isRetriablePinError(error) {
  const code = getErrorCode(error);
  const text = String(error?.message || "").toLowerCase();
  return code === 500 || text.includes("internal server error") || text.includes("timed out");
}

function isTransientEditError(error) {
  const code = getErrorCode(error);
  const text = String(getErrorDescription(error) || getErrorText(error) || "").toLowerCase();
  return code === 500 || text.includes("internal server error") || text.includes("timed out");
}

function resolveChatId(ctx) {
  return (
    ctx.chat?.id ||
    ctx.callbackQuery?.message?.chat?.id ||
    ctx.message?.chat?.id
  );
}

async function callTelegramApiWithTimeout(ctx, method, payload, timeoutMs) {
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
    return await Promise.race([callPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    callPromise.catch(() => {});
  }
}

function createAppContext(ctx, user, options = {}) {
  const operationTimeoutMs = Number(options.operationTimeoutMs) || DEFAULT_API_OPERATION_TIMEOUT_MS;

  const sendApi = (method, payload) => callTelegramApiWithTimeout(
    ctx,
    method,
    payload,
    operationTimeoutMs,
  );

  return {
    user,
    userId: user?.userId,
    languageCode: ctx.from?.language_code,
    message: ctx.message,
    text: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,
    callbackMessage: ctx.callbackQuery?.message,
    callbackMessageId: ctx.callbackQuery?.message?.message_id || ctx.callbackQuery?.message?.messageId,
    wasUserCreated: Boolean(options.wasUserCreated),

    reply: (...args) => ctx.reply(...args),
    replyWithPhoto: (...args) => ctx.replyWithPhoto(...args),
    answerCb: (text = "", extra = undefined) => {
      const payload = {
        callback_query_id: ctx.callbackQuery?.id,
        text: String(text || ""),
        ...(extra && typeof extra === "object" ? extra : {}),
      };
      if (payload.callback_query_id && ctx.telegram?.callApi) {
        return ctx.telegram.callApi("answerCallbackQuery", payload).catch((error) => {
          if (payload.show_alert) {
            logger.warn("answerCallbackQuery show_alert failed", {
              callbackQueryId: String(payload.callback_query_id || ""),
              error: error?.message || error,
            });
          }
        });
      }
      return ctx.answerCbQuery(String(text || "")).catch(() => {});
    },
    sendToUser: async (userId, text, extra = {}) => {
      const targetUserId = Number(userId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !ctx.telegram?.callApi) {
        return false;
      }
      try {
        return await sendApi("sendMessage", {
          chat_id: targetUserId,
          text,
          ...extra,
        });
      } catch {
        return false;
      }
    },
    editMessage: (...args) => ctx.editMessageText(...args),
    editMessageText: async (messageId, text, extra = {}) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await sendApi("editMessageText", {
          chat_id: chatId,
          message_id: normalizedMessageId,
          text,
          ...extra,
        });
      } catch (error) {
        if (isMessageNotFoundError(error) || isTransientEditError(error)) {
          return false;
        }
        logger.warn("Failed to edit bot message", {
          chatId,
          messageId: normalizedMessageId,
          code: getErrorCode(error),
          description: getErrorDescription(error),
          error: getErrorText(error),
        });
        return false;
      }
    },
    editMessageReplyMarkup: async (messageId, replyMarkup = {}) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await sendApi("editMessageReplyMarkup", {
          chat_id: chatId,
          message_id: normalizedMessageId,
          reply_markup: replyMarkup,
        });
      } catch {
        return false;
      }
    },
    deleteMessage: async (messageId) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await sendApi("deleteMessage", {
          chat_id: chatId,
          message_id: normalizedMessageId,
        });
      } catch {
        return false;
      }
    },
    pinMessage: async (messageId) => {
      const chatId = resolveChatId(ctx);
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
          return await sendApi("pinChatMessage", pinPayloads[attempt]);
        } catch (error) {
          lastError = error;
          if (!isRetriablePinError(error) || attempt >= pinPayloads.length - 1) {
            break;
          }
        }
      }

      logger.error("Failed to pin chat message", {
        chatId,
        messageId: normalizedMessageId,
        code: getErrorCode(lastError),
        description: getErrorDescription(lastError),
        error: getErrorText(lastError),
      });
      return false;
    },
    unpinMessage: async (messageId) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await sendApi("unpinChatMessage", {
          chat_id: chatId,
          message_id: normalizedMessageId,
        });
      } catch (error) {
        logger.error("Failed to unpin chat message", {
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

module.exports = {
  createAppContext,
};
