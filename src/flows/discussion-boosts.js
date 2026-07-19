const messages = require("../messages");
const { callBacks } = require("../constants");
const {
  discussionBoostAckKeyboard,
  discussionJoinErrorAckKeyboard,
  discussionRoomKeyboard,
  inlineKeyboard,
} = require("../keyboards");
const {
  confirmBoost,
  createBoostQuote,
  markBoostDeliverySent,
  markBoostNotInterested,
  recordBoostDelivery,
  releaseBoostDelivery,
  selectBoostRecipients,
} = require("../services/discussion-boosts");
const { joinOrOpenDiscussion } = require("../services/discussions");
const { getDiscussionDisplayTitle } = require("../services/discussion-ui");
const { buildDiscussionRoomKeyboard } = require("../services/discussion-room-ui");
const { formatStarNumber } = require("../services/stars-ui");
const { starEconomy } = require("../services/star-settings");
const { updateProfileField } = require("../services/users");

function isDiscussionBoostText(text = "") {
  const normalized = String(text || "").trim();
  return [messages.fa.discussionBoostButton, messages.en.discussionBoostButton].includes(normalized);
}

function isDiscussionBoostCallback(data = "") {
  return data.startsWith(callBacks.discussionBoostConfirm)
    || data.startsWith(callBacks.discussionBoostCancel)
    || data === callBacks.discussionBoostAck
    || data.startsWith(callBacks.discussionBoostNotInterested)
    || data === callBacks.discussionBoostOptOut;
}

function boostConfirmationKeyboard(lang, quote, source = "room") {
  const cost = formatStarNumber(quote.quotedCost, lang);
  const callbackToken = `${source === "mine" ? "mine" : "room"}:${quote.publicCode}`;
  return inlineKeyboard([
    [{
      text: messages[lang].discussionBoostConfirmButton.replace("{cost}", cost),
      callback_data: `${callBacks.discussionBoostConfirm}${callbackToken}`,
    }],
    [{
      text: messages[lang].discussionBoostCancelButton,
      callback_data: `${callBacks.discussionBoostCancel}${callbackToken}`,
    }],
  ]);
}

function fillBoostText(template, lang, values = {}) {
  return String(template || "")
    .replaceAll("{title}", values.title || "-")
    .replaceAll("{hours}", formatStarNumber(values.hours, lang))
    .replaceAll("{cost}", formatStarNumber(values.cost, lang))
    .replaceAll("{balance}", formatStarNumber(values.balance, lang))
    .replaceAll("{count}", formatStarNumber(values.count, lang));
}

function getBoostErrorText(lang, result = {}) {
  const keyByReason = {
    boost_disabled: "discussionBoostDisabled",
    not_owner: "discussionBoostNotOwner",
    boost_already_active: "discussionBoostAlreadyActive",
    boost_cooldown: "discussionBoostCooldown",
    quote_expired: "discussionBoostQuoteExpired",
    missing_quote: "discussionBoostQuoteExpired",
    stale_price: "discussionBoostStalePrice",
    discussion_full: "discussionErrFull",
  };
  if (result.reason === "insufficient_balance") {
    return fillBoostText(messages[lang].discussionBoostInsufficient, lang, {
      cost: result.amount || starEconomy.discussionBoostCost,
      balance: result.balance || 0,
    });
  }
  if (result.reason === "activation_failed") {
    return result.refunded
      ? messages[lang].discussionBoostFailedRefunded
      : messages[lang].discussionBoostFailed;
  }
  return messages[lang][keyByReason[result.reason]] || messages[lang].discussionBoostFailed;
}

function parseBoostCallbackPayload(ctx, data = "", prefix = "") {
  const raw = data.replace(prefix, "");
  const [maybeSource, maybeCode] = raw.split(":");
  if (maybeCode) {
    return {
      source: maybeSource === "mine" ? "mine" : "room",
      code: maybeCode,
    };
  }
  return {
    source: ctx?.user?.activeDiscussionId ? "room" : "mine",
    code: raw,
  };
}

function boostErrorKeyboard(lang, source) {
  return source === "mine"
    ? discussionJoinErrorAckKeyboard(lang, "mine")
    : discussionBoostAckKeyboard(lang);
}

async function restoreRoomControls(ctx, lang, text = messages[lang].discussionBoostCanceled) {
  const activeDiscussionId = String(ctx.user?.activeDiscussionId || "");
  if (!activeDiscussionId) return ctx.reply(messages[lang].discussionNotMember);

  const opened = await joinOrOpenDiscussion(ctx.userId, activeDiscussionId);
  if (!opened.ok) return ctx.reply(messages[lang].discussionNotMember);

  return ctx.reply(
    text,
    await buildDiscussionRoomKeyboard(lang, opened.discussion, ctx.userId),
  );
}

async function showBoostQuote(ctx, lang, discussionIdOverride = "", source = "room") {
  const discussionId = String(discussionIdOverride || ctx.user?.activeDiscussionId || "");
  if (!discussionId) return ctx.reply(messages[lang].discussionNotMember);
  const quoted = await createBoostQuote(ctx.userId, discussionId);
  if (!quoted.ok) return ctx.reply(getBoostErrorText(lang, quoted));
  return ctx.reply(
    fillBoostText(messages[lang].discussionBoostConfirmText, lang, {
      title: getDiscussionDisplayTitle(messages, lang, quoted.discussion),
      hours: starEconomy.discussionBoostDurationHours,
      cost: quoted.quote.quotedCost,
      balance: ctx.user?.starBalance || 0,
    }),
    boostConfirmationKeyboard(lang, quoted.quote, source),
  );
}

async function deliverBoostRecommendations(ctx, boost, discussion) {
  const recipients = await selectBoostRecipients(boost, discussion);
  for (const { user } of recipients) {
    const lang = messages[user.lang] ? user.lang : "fa";
    const delivery = await recordBoostDelivery(boost, discussion, user.userId);
    if (!delivery) continue;
    const text = fillBoostText(messages[lang].discussionBoostRecommendation, lang, {
      title: getDiscussionDisplayTitle(messages, lang, discussion),
      count: discussion.memberUserIds?.length || 0,
    });
    const sent = await ctx.sendToUser?.(user.userId, text, inlineKeyboard([
      [{
        text: messages[lang].discussionBoostPreviewButton,
        callback_data: `${callBacks.discussionOpen}${discussion._id}`,
      }],
      [
        {
          text: messages[lang].discussionBoostNotInterestedButton,
          callback_data: `${callBacks.discussionBoostNotInterested}${boost.publicCode}`,
        },
        {
          text: messages[lang].discussionBoostOptOutButton,
          callback_data: callBacks.discussionBoostOptOut,
        },
      ],
    ]), lang);
    if (sent) await markBoostDeliverySent(delivery._id, user.userId);
    else await releaseBoostDelivery(delivery._id, user.userId);
  }
}

async function handleDiscussionBoostCallback(ctx, lang, {
  deleteCallbackMessageIfPossible,
  editCallbackMessageOrReply,
  renderMyDiscussionList,
} = {}) {
  const data = ctx.callbackData || "";
  if (data === callBacks.discussionBoostAck) {
    await ctx.answerCb?.();
    await deleteCallbackMessageIfPossible?.(ctx);
    return restoreRoomControls(ctx, lang);
  }
  if (data.startsWith(callBacks.discussionBoostCancel)) {
    const { source } = parseBoostCallbackPayload(ctx, data, callBacks.discussionBoostCancel);
    await ctx.answerCb?.(messages[lang].discussionBoostCanceled.replace(/^(?:🤖|👩‍🦳)\s*/, ""));
    await deleteCallbackMessageIfPossible?.(ctx);
    if (source === "mine" && renderMyDiscussionList) {
      return renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    return restoreRoomControls(ctx, lang, messages[lang].discussionBoostCanceled);
  }
  if (data.startsWith(callBacks.discussionBoostConfirm)) {
    await ctx.answerCb?.();
    const { source, code } = parseBoostCallbackPayload(ctx, data, callBacks.discussionBoostConfirm);
    const confirmed = await confirmBoost(ctx.userId, code);
    if (!confirmed.ok) {
      const text = getBoostErrorText(lang, confirmed);
      const keyboard = boostErrorKeyboard(lang, source);
      if (ctx.callbackMessageId && ctx.editMessageText) {
        const edited = await ctx.editMessageText(ctx.callbackMessageId, text, keyboard);
        if (edited) return edited;
      }
      return ctx.reply(text, keyboard);
    }
    if (ctx.user) ctx.user.starBalance = confirmed.spend.balance;
    const text = fillBoostText(messages[lang].discussionBoostActivated, lang, {
      hours: starEconomy.discussionBoostDurationHours,
      cost: confirmed.boost.quotedCost,
      balance: confirmed.spend.balance,
    });
    if (confirmed.applied) void deliverBoostRecommendations(ctx, confirmed.boost, confirmed.discussion);
    if (source === "room") {
      await deleteCallbackMessageIfPossible?.(ctx);
      return ctx.reply(
        text,
        discussionRoomKeyboard(lang, true, { canBoost: false }),
      );
    }
    if (ctx.callbackMessageId && ctx.editMessageText) {
      const edited = await ctx.editMessageText(ctx.callbackMessageId, text, inlineKeyboard([]));
      if (edited) {
        if (source === "mine" && renderMyDiscussionList) {
          await renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
        }
        return edited;
      }
    }
    const sent = await ctx.reply(text);
    if (source === "mine" && renderMyDiscussionList) {
      await renderMyDiscussionList(ctx, lang, 0, { editCallbackMessageOrReply });
    }
    return sent;
  }
  if (data.startsWith(callBacks.discussionBoostNotInterested)) {
    await ctx.answerCb?.(messages[lang].discussionBoostNotInterestedAck);
    await markBoostNotInterested(data.replace(callBacks.discussionBoostNotInterested, ""), ctx.userId);
    return deleteCallbackMessageIfPossible?.(ctx);
  }
  if (data === callBacks.discussionBoostOptOut) {
    await ctx.answerCb?.(messages[lang].discussionBoostOptOutAck);
    await updateProfileField(ctx.userId, "receiveBoostRecommendations", false);
    if (ctx.user) ctx.user.receiveBoostRecommendations = false;
    return deleteCallbackMessageIfPossible?.(ctx);
  }
  return false;
}

module.exports = {
  handleDiscussionBoostCallback,
  isDiscussionBoostCallback,
  isDiscussionBoostText,
  showBoostQuote,
};
