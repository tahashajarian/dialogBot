const messages = require("../messages");
const { callBacks } = require("../constants");
const { inlineKeyboard } = require("../keyboards");
const {
  confirmBoost,
  createBoostQuote,
  markBoostDeliverySent,
  markBoostNotInterested,
  recordBoostDelivery,
  releaseBoostDelivery,
  selectBoostRecipients,
} = require("../services/discussion-boosts");
const { getDiscussionDisplayTitle } = require("../services/discussion-ui");
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
    || data.startsWith(callBacks.discussionBoostNotInterested)
    || data === callBacks.discussionBoostOptOut;
}

function boostConfirmationKeyboard(lang, quote) {
  const cost = formatStarNumber(quote.quotedCost, lang);
  return inlineKeyboard([
    [{
      text: messages[lang].discussionBoostConfirmButton.replace("{cost}", cost),
      callback_data: `${callBacks.discussionBoostConfirm}${quote.publicCode}`,
    }],
    [{
      text: messages[lang].discussionBoostCancelButton,
      callback_data: `${callBacks.discussionBoostCancel}${quote.publicCode}`,
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

async function showBoostQuote(ctx, lang) {
  const discussionId = String(ctx.user?.activeDiscussionId || "");
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
    boostConfirmationKeyboard(lang, quoted.quote),
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
    ]));
    if (sent) await markBoostDeliverySent(delivery._id, user.userId);
    else await releaseBoostDelivery(delivery._id, user.userId);
  }
}

async function handleDiscussionBoostCallback(ctx, lang, { deleteCallbackMessageIfPossible } = {}) {
  const data = ctx.callbackData || "";
  if (data.startsWith(callBacks.discussionBoostCancel)) {
    await ctx.answerCb?.();
    return deleteCallbackMessageIfPossible?.(ctx);
  }
  if (data.startsWith(callBacks.discussionBoostConfirm)) {
    await ctx.answerCb?.();
    const code = data.replace(callBacks.discussionBoostConfirm, "");
    const confirmed = await confirmBoost(ctx.userId, code);
    if (!confirmed.ok) {
      const text = getBoostErrorText(lang, confirmed);
      if (ctx.callbackMessageId && ctx.editMessageText) {
        const edited = await ctx.editMessageText(ctx.callbackMessageId, text, inlineKeyboard([]));
        if (edited) return edited;
      }
      return ctx.reply(text);
    }
    if (ctx.user) ctx.user.starBalance = confirmed.spend.balance;
    const text = fillBoostText(messages[lang].discussionBoostActivated, lang, {
      hours: starEconomy.discussionBoostDurationHours,
      cost: confirmed.boost.quotedCost,
      balance: confirmed.spend.balance,
    });
    if (confirmed.applied) void deliverBoostRecommendations(ctx, confirmed.boost, confirmed.discussion);
    if (ctx.callbackMessageId && ctx.editMessageText) {
      const edited = await ctx.editMessageText(ctx.callbackMessageId, text, inlineKeyboard([]));
      if (edited) return edited;
    }
    return ctx.reply(text);
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
