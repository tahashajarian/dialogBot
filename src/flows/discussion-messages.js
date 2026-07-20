const messages = require("../messages");
const { getMessageId } = require("../services/bot-navigation");
const { addRecentMessage } = require("../services/discussion-messages");
const { buildDiscussionRoomKeyboard } = require("../services/discussion-room-ui");
const { formatUserDisplayName } = require("../services/profile");
const { mapWithConcurrency } = require("../services/bounded-concurrency");
const { logger } = require("../services/logger");
const {
  findDiscussionDelivery,
  getReplyMessageIdForRecipient,
  rememberDiscussionDelivery,
} = require("../services/discussion-delivery-memory");

const DISCUSSION_DELIVERY_CONCURRENCY = 8;

function getReplyMessageId(message = {}) {
  const reply = message.reply_to_message || message.replyToMessage || {};
  const messageId = Number(getMessageId(reply));
  return Number.isInteger(messageId) && messageId > 0 ? messageId : null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDiscussionOutboundMessage(messagesByLang, lang, { senderDisplayName, text }) {
  const sender = senderDisplayName || (lang === "fa" ? "کاربر" : "User");
  return messagesByLang[lang].discussionMessageInbound
    .replace("{sender}", `<b>${escapeHtml(sender)}</b>`)
    .replace("{text}", escapeHtml(String(text || "").trim()));
}

function isUnsupportedDiscussionMessage(ctx, state, text) {
  const hasVoice = ctx.message?.voice;
  return Boolean(
    state === "idle"
    && ctx.user?.activeDiscussionId
    && ctx.message
    && !text
    && !hasVoice,
  );
}

async function replyToUnsupportedDiscussionMessage(ctx, text, extra = {}) {
  const messageId = getMessageId(ctx.message);
  if (messageId) {
    try {
      return await ctx.reply(text, { ...extra, reply_to_message_id: messageId });
    } catch {
      // A normal reply still gives the user clear delivery feedback.
    }
  }
  return Object.keys(extra).length ? ctx.reply(text, extra) : ctx.reply(text);
}

async function sendDiscussionMessageToRecipient(ctx, recipientUserId, payload, replyDelivery) {
  const replyMessageId = getReplyMessageIdForRecipient(replyDelivery, recipientUserId);

  if (payload?.voice) {
    if (!replyMessageId) {
      return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
    }
    let sent = null;
    try {
      sent = await ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id, {
        reply_to_message_id: replyMessageId,
      });
    } catch {
      sent = null;
    }
    if (sent) return sent;
    return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
  }

  const text = typeof payload === "string" ? payload : payload?.text;
  const payloadExtra = typeof payload === "object" && payload?.extra ? payload.extra : {};
  if (!replyMessageId) {
    return ctx.sendToUser?.(recipientUserId, text, payloadExtra);
  }

  let sent = null;
  try {
    sent = await ctx.sendToUser?.(recipientUserId, text, {
      ...payloadExtra,
      reply_to_message_id: replyMessageId,
    });
  } catch {
    sent = null;
  }
  if (sent) return sent;
  return ctx.sendToUser?.(recipientUserId, text);
}

async function handleDiscussionMessage(ctx, lang, messageType, payload) {
  const senderName = formatUserDisplayName(ctx.user);
  const added = await addRecentMessage({
    discussionId: ctx.user.activeDiscussionId,
    senderUserId: ctx.userId,
    senderDisplayName: senderName,
    ...payload,
  });

  if (!added.ok) {
    if (added.reason === "message_burst_limit") {
      return replyToUnsupportedDiscussionMessage(
        ctx,
        messages[lang].discussionMessageBurstLimit,
        await buildDiscussionRoomKeyboard(lang, added.discussion, ctx.userId),
      );
    }
    if (added.reason === "message_rate_limit") {
      return replyToUnsupportedDiscussionMessage(
        ctx,
        messages[lang].discussionMessageRateLimit,
        await buildDiscussionRoomKeyboard(lang, added.discussion, ctx.userId),
      );
    }
    if (added.reason === "message_contains_link") {
      return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoLinks);
    }
    if (added.reason === "message_command_like") {
      return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoCommands);
    }
    return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageSendFailed);
  }

  const deliveriesByUserId = {
    [ctx.userId]: getMessageId(ctx.message),
  };

  const deliveryResults = await mapWithConcurrency(
    added.recipients || [],
    DISCUSSION_DELIVERY_CONCURRENCY,
    async (recipientUserId) => {
      try {
        const sent = await sendDiscussionMessageToRecipient(
          ctx,
          recipientUserId,
          messageType === "voice"
            ? { voice: { file_id: payload.voiceFileId, duration: payload.voiceDuration || 0 } }
            : {
                text: formatDiscussionOutboundMessage(messages, lang, { senderDisplayName: senderName, text: payload.text }),
                extra: { parse_mode: "HTML" },
              },
          messageType === "text" ? findDiscussionDelivery({
            userId: ctx.userId,
            messageId: getReplyMessageId(ctx.message),
            discussionId: ctx.user.activeDiscussionId,
          }) : undefined,
        );
        const sentMessageId = getMessageId(sent);
        if (sentMessageId) deliveriesByUserId[recipientUserId] = sentMessageId;
        return Boolean(sent);
      } catch {
        return false;
      }
    },
  );

  const failedDeliveries = deliveryResults.filter((delivered) => !delivered).length;
  if (failedDeliveries) {
    logger.warn("Discussion message delivery incomplete", {
      discussionId: String(ctx.user.activeDiscussionId),
      messageType,
      attempted: deliveryResults.length,
      delivered: deliveryResults.length - failedDeliveries,
      failed: failedDeliveries,
    });
  }

  rememberDiscussionDelivery({
    discussionId: ctx.user.activeDiscussionId,
    deliveriesByUserId,
  });

  return true;
}

module.exports = {
  DISCUSSION_DELIVERY_CONCURRENCY,
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  handleDiscussionMessage,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
};
