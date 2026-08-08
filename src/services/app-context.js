const DEFAULT_API_OPERATION_TIMEOUT_MS = 2500;
const SLOW_TELEGRAM_API_MS = 1200;
const PIN_RETRY_DELAY_MS = 400;
const { logger } = require("./logger");
const { formatBotText, formatBotExtra } = require("./bot-appearance");
const { localizeOutgoingExtra, localizeVisibleDigits } = require("./number-localization");
const { CapacityError } = require("./capacity-guard");
const { notificationCapacity: defaultNotificationCapacity } = require("./runtime-capacity");
const { recordCapacityEvent } = require("./operational-health");

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
  return (
    (code === 404 && description.includes("message not found")) ||
    (code === 400 && description.includes("message to edit not found"))
  );
}

function isRetriablePinError(error) {
  const code = getErrorCode(error);
  const text = String(error?.message || "").toLowerCase();
  return code === 500 || text.includes("internal server error") || text.includes("timed out");
}

function isAmbiguousEditError(error) {
  const code = getErrorCode(error);
  const text = String(getErrorDescription(error) || getErrorText(error) || "").toLowerCase();
  return (
    code === 500 ||
    text.includes("internal server error") ||
    text.includes("timed out") ||
    text.includes("message is not modified")
  );
}

function resolveChatId(ctx) {
  return (
    ctx.chat?.id ||
    ctx.callbackQuery?.message?.chat?.id ||
    ctx.message?.chat?.id
  );
}

function recordApiMetric(metrics, method, durationMs) {
  if (!metrics) return;
  metrics.count += 1;
  metrics.totalMs += durationMs;
  if (durationMs > metrics.maxMs) {
    metrics.maxMs = durationMs;
    metrics.slowestMethod = method;
  }
}

async function callTelegramApiWithTimeout(ctx, method, payload, timeoutMs, metrics) {
  if (!ctx.telegram?.callApi) {
    return false;
  }

  const startedAt = Date.now();
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
    const result = await Promise.race([callPromise, timeoutPromise]);
    const durationMs = Date.now() - startedAt;
    recordApiMetric(metrics, method, durationMs);
    if (durationMs >= SLOW_TELEGRAM_API_MS) {
      logger.warn("Slow Telegram API call", { method, durationMs });
    }
    return result;
  } finally {
    clearTimeout(timeoutId);
    callPromise.catch(() => {});
  }
}

async function withTelegramTiming(label, fn, metrics) {
  const startedAt = Date.now();
  const result = await fn();
  const durationMs = Date.now() - startedAt;
  recordApiMetric(metrics, label, durationMs);
  if (durationMs >= SLOW_TELEGRAM_API_MS) {
    logger.warn("Slow Telegram API call", { method: label, durationMs });
  }
  return result;
}

function createAppContext(ctx, user, options = {}) {
  const operationTimeoutMs = Number(options.operationTimeoutMs) || DEFAULT_API_OPERATION_TIMEOUT_MS;
  const apiMetrics = options.apiMetrics || null;
  const notificationCapacity = options.notificationCapacity || defaultNotificationCapacity;
  const recordCapacity = options.recordCapacityEvent || recordCapacityEvent;
  const userLang = user?.lang === "fa" ? "fa" : "en";
  const formatText = (text, lang = userLang) => localizeVisibleDigits(formatBotText(text), lang);
  const formatExtra = (extra, lang = userLang) => localizeOutgoingExtra(formatBotExtra(extra), lang);

  const sendApi = (method, payload) => callTelegramApiWithTimeout(
    ctx,
    method,
    payload,
    operationTimeoutMs,
    apiMetrics,
  );

  return {
    user,
    userId: user?.userId,
    botInfo: options.botInfo || ctx.botInfo || null,
    languageCode: ctx.from?.language_code,
    message: ctx.message,
    text: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,
    callbackMessage: ctx.callbackQuery?.message,
    callbackMessageId: ctx.callbackQuery?.message?.message_id || ctx.callbackQuery?.message?.messageId,
    wasUserCreated: Boolean(options.wasUserCreated),
    canRestartAfterDeletion: Boolean(options.canRestartAfterDeletion),

    reply: (text, extra = undefined) => withTelegramTiming(
      "sendMessage",
      () => ctx.reply(formatText(text), formatExtra(extra)),
      apiMetrics,
    ),
    replyWithPhoto: (photo, extra = undefined) => withTelegramTiming(
      "sendPhoto",
      () => ctx.replyWithPhoto(photo, formatExtra(extra)),
      apiMetrics,
    ),
    sendChatAction: (action = "typing") => {
      const chatId = resolveChatId(ctx);
      if (!chatId) return Promise.resolve(false);
      if (ctx.telegram?.callApi) {
        return sendApi("sendChatAction", { chat_id: chatId, action });
      }
      if (typeof ctx.sendChatAction === "function") {
        return withTelegramTiming("sendChatAction", () => ctx.sendChatAction(action), apiMetrics);
      }
      return Promise.resolve(false);
    },
    answerCb: (text = "", extra = undefined) => {
      const payload = {
        callback_query_id: ctx.callbackQuery?.id,
        text: formatText(String(text || "")),
        ...(extra && typeof extra === "object" ? extra : {}),
      };
      const shouldAwait = Boolean(payload.show_alert);
      if (payload.callback_query_id && ctx.telegram?.callApi) {
        const promise = withTelegramTiming(
          "answerCallbackQuery",
          () => ctx.telegram.callApi("answerCallbackQuery", payload),
          apiMetrics,
        ).catch((error) => {
            if (payload.show_alert) {
              logger.warn("answerCallbackQuery show_alert failed", {
                callbackQueryId: String(payload.callback_query_id || ""),
                error: error?.message || error,
              });
            }
          });
        if (!shouldAwait) {
          void promise;
          return Promise.resolve(true);
        }
        return promise;
      }
      const promise = withTelegramTiming(
        "answerCallbackQuery",
        () => ctx.answerCbQuery(formatText(String(text || ""))),
        apiMetrics,
      ).catch(() => {});
      if (!shouldAwait) {
        void promise;
        return Promise.resolve(true);
      }
      return promise;
    },
    sendToUser: async (userId, text, extra = {}, recipientLang = null) => {
      const targetUserId = Number(userId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !ctx.telegram?.callApi) {
        return false;
      }
      try {
        return await notificationCapacity.run("", () => sendApi("sendMessage", {
          chat_id: targetUserId,
          text: formatText(text, recipientLang || userLang),
          ...formatExtra(extra, recipientLang || userLang),
        }));
      } catch (error) {
        if (error instanceof CapacityError) {
          void recordCapacity({
            resource: "telegram_notification",
            reason: error.reason,
            state: notificationCapacity.getState(),
          });
        }
        return false;
      }
    },
    editMessage: (text, extra = undefined) => ctx.editMessageText(formatText(text), formatExtra(extra)),
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
          text: formatText(text),
          ...formatExtra(extra),
        });
      } catch (error) {
        if (isMessageNotFoundError(error)) {
          return false;
        }
        // A timeout/5xx does not tell us whether Telegram applied the edit.
        // Preserve that distinction so terminal flows can replace temporary
        // content while ordinary navigation still suppresses duplicate cards.
        if (isAmbiguousEditError(error)) {
          logger.warn("Telegram message edit result was uncertain; suppressing fallback", {
            chatId,
            messageId: normalizedMessageId,
            code: getErrorCode(error),
            error: getErrorText(error),
          });
          return {
            message_id: normalizedMessageId,
            edit_uncertain: true,
          };
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
    editMessageCaption: async (messageId, caption, extra = {}) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
        return false;
      }

      try {
        return await sendApi("editMessageCaption", {
          chat_id: chatId,
          message_id: normalizedMessageId,
          caption: formatText(caption),
          ...formatExtra(extra),
        });
      } catch (error) {
        if (isMessageNotFoundError(error)) return false;
        if (isAmbiguousEditError(error)) return true;
        logger.warn("Failed to edit bot message caption", {
          chatId,
          messageId: normalizedMessageId,
          code: getErrorCode(error),
          description: getErrorDescription(error),
          error: getErrorText(error),
        });
        return false;
      }
    },
    editMessageMedia: async (messageId, media, extra = {}) => {
      const chatId = resolveChatId(ctx);
      const normalizedMessageId = Number(messageId);
      if (!chatId || !Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0 || !media) {
        return false;
      }

      try {
        return await sendApi("editMessageMedia", {
          chat_id: chatId,
          message_id: normalizedMessageId,
          media: {
            ...media,
            ...(media.caption ? { caption: formatText(media.caption) } : {}),
          },
          ...formatExtra(extra),
        });
      } catch (error) {
        if (isMessageNotFoundError(error)) return false;
        if (isAmbiguousEditError(error)) return true;
        logger.warn("Failed to edit bot message media", {
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
          reply_markup: formatExtra({ reply_markup: replyMarkup })?.reply_markup || replyMarkup,
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
      const incomingMessageId = Number(ctx.message?.message_id || ctx.message?.messageId);
      if (Number.isInteger(incomingMessageId) && normalizedMessageId === incomingMessageId) {
        logger.warn("Refused to delete the current user message", {
          chatId,
          messageId: normalizedMessageId,
        });
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
