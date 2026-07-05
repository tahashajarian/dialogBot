const messages = require("../messages");
const { discussionRoomKeyboard } = require("../keyboards");
const { getMessageId } = require("../services/bot-navigation");
const { addRecentMessage } = require("../services/discussion-messages");
const { formatUserDisplayName } = require("../services/profile");
const {
  findDiscussionDelivery,
  getReplyMessageIdForRecipient,
  rememberDiscussionDelivery,
} = require("../services/discussion-delivery-memory");

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

async function replyToUnsupportedDiscussionMessage(ctx, text) {
  const messageId = getMessageId(ctx.message);
  if (messageId) {
    try {
      return await ctx.reply(text, { reply_to_message_id: messageId });
    } catch {
      // A normal reply still gives the user clear delivery feedback.
    }
  }
  return ctx.reply(text);
}

async function sendDiscussionMessageToRecipient(ctx, recipientUserId, payload, replyDelivery) {
  const replyMessageId = getReplyMessageIdForRecipient(replyDelivery, recipientUserId);

  if (payload?.voice) {
    if (!replyMessageId) {
      return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
    }
    const sent = await ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id, {
      reply_to_message_id: replyMessageId,
    });
    if (sent) return sent;
    return ctx.telegram?.sendVoice(recipientUserId, payload.voice.file_id);
  }

  const text = typeof payload === "string" ? payload : payload?.text;
  const payloadExtra = typeof payload === "object" && payload?.extra ? payload.extra : {};
  if (!replyMessageId) {
    return ctx.sendToUser?.(recipientUserId, text, payloadExtra);
  }

  const sent = await ctx.sendToUser?.(recipientUserId, text, {
    ...payloadExtra,
    reply_to_message_id: replyMessageId,
  });
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
      return ctx.reply(
        messages[lang].discussionMessageBurstLimit,
        discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
      );
    }
    if (added.reason === "message_rate_limit") {
      return ctx.reply(
        messages[lang].discussionMessageRateLimit,
        discussionRoomKeyboard(lang, added.discussion?.creatorUserId === ctx.userId),
      );
    }
    if (added.reason === "message_contains_link") {
      return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoLinks);
    }
    if (added.reason === "message_command_like") {
      return replyToUnsupportedDiscussionMessage(ctx, messages[lang].discussionMessageNoCommands);
    }
    return ctx.reply(messages[lang].discussionMessageSendFailed);
  }

  const deliveriesByUserId = {
    [ctx.userId]: getMessageId(ctx.message),
  };

  await Promise.all((added.recipients || []).map(async (recipientUserId) => {
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
    if (sentMessageId) {
      deliveriesByUserId[recipientUserId] = sentMessageId;
    }
  }));

  rememberDiscussionDelivery({
    discussionId: ctx.user.activeDiscussionId,
    deliveriesByUserId,
  });

  return true;
}

module.exports = {
  formatDiscussionOutboundMessage,
  getReplyMessageId,
  handleDiscussionMessage,
  isUnsupportedDiscussionMessage,
  replyToUnsupportedDiscussionMessage,
  sendDiscussionMessageToRecipient,
};
