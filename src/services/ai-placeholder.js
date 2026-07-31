function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

function hasReplyKeyboard(extra) {
  const replyMarkup = extra?.reply_markup;
  return Boolean(
    replyMarkup
    && (
      Array.isArray(replyMarkup.keyboard)
      || replyMarkup.remove_keyboard
      || replyMarkup.force_reply
    )
  );
}

async function editPlaceholder(ctx, placeholder, text, extra, {
  deleteOnFallback = true,
  fallbackToReply = true,
  replaceOnUncertain = false,
  allowEdit = true,
  onEditRejected = null,
} = {}) {
  const messageId = getMessageId(placeholder);
  // Telegram only accepts inline keyboards while editing a message. Reply
  // keyboards must be attached to a newly sent message.
  if (allowEdit && messageId && ctx.editMessageText && !hasReplyKeyboard(extra)) {
    const edited = await ctx.editMessageText(messageId, text, extra);
    if (edited) {
      if (replaceOnUncertain && edited.edit_uncertain) {
        if (ctx.deleteMessage) await ctx.deleteMessage(messageId);
        return fallbackToReply ? ctx.reply(text, extra) : placeholder;
      }
      return getMessageId(edited) ? edited : placeholder;
    }
    if (typeof onEditRejected === "function") onEditRejected();
  }

  if (deleteOnFallback && messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }

  return fallbackToReply ? ctx.reply(text, extra) : placeholder;
}

async function startAiPlaceholder(ctx, steps, options = {}) {
  const initialPlaceholder = options.placeholder || null;
  const retainSteps = Boolean(options.retainSteps);
  const disableEdits = Boolean(options.disableEdits);
  let placeholder;
  if ((retainSteps || disableEdits) && initialPlaceholder) {
    const initialMessageId = getMessageId(initialPlaceholder);
    if (initialMessageId && ctx.deleteMessage) {
      try {
        await ctx.deleteMessage(initialMessageId);
      } catch (_) {
        // The caller may already have retired the action card.
      }
    }
    placeholder = await ctx.reply(steps[0], options.initialExtra);
  } else if (initialPlaceholder) {
    placeholder = await editPlaceholder(ctx, initialPlaceholder, steps[0], options.initialExtra, {
      deleteOnFallback: false,
    });
  } else {
    placeholder = await ctx.reply(steps[0], options.initialExtra);
  }

  // Telegram can reject edits to a message that was also used to remove a
  // reply keyboard. When live progress is important, retire that setup
  // message and create a plain bot message that can be edited safely.
  if (
    options.ensureEditable
    && !disableEdits
    && hasReplyKeyboard(options.initialExtra)
    && getMessageId(placeholder)
  ) {
    const setupMessage = placeholder;
    placeholder = await ctx.reply(steps[0]);
    if (ctx.deleteMessage) {
      try {
        await ctx.deleteMessage(getMessageId(setupMessage));
      } catch (_) {
        // The keyboard has already been removed; a cleanup failure should not
        // stop suggestion generation or the live progress indicator.
      }
    }
  }

  const timers = [];
  let settled = false;
  let placeholderEditable = !disableEdits;
  const replaceProgress = Boolean(options.replaceProgress);
  let editQueue = Promise.resolve(placeholder);

  const queueEdit = (text, extra, { terminal = false } = {}) => {
    editQueue = editQueue.then(async () => {
      if (settled && !terminal) return placeholder;
      if (retainSteps) return ctx.reply(text, extra);
      if (disableEdits && !terminal) return placeholder;
      if (replaceProgress) {
        const currentMessageId = getMessageId(placeholder);
        if (currentMessageId && ctx.deleteMessage) {
          try {
            await ctx.deleteMessage(currentMessageId);
          } catch (_) {
            // Replacing progress must not interrupt the underlying work.
          }
        }
        const replacement = await ctx.reply(text, extra);
        if (getMessageId(replacement)) placeholder = replacement;
        return replacement;
      }
      const updated = await editPlaceholder(ctx, placeholder, text, extra, {
        deleteOnFallback: terminal,
        fallbackToReply: terminal,
        replaceOnUncertain: terminal,
        allowEdit: placeholderEditable,
        onEditRejected: () => {
          placeholderEditable = false;
        },
      });
      if (getMessageId(updated)) placeholder = updated;
      return updated;
    });
    return editQueue;
  };

  for (let index = 1; index < steps.length; index += 1) {
    const configuredDelay = Array.isArray(options.stepDelays) ? Number(options.stepDelays[index - 1]) : NaN;
    const delayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 2500 + ((index - 1) * 3000);
    const timer = setTimeout(() => {
      if (settled) return;
      queueEdit(steps[index]).catch(() => {});
    }, delayMs);
    timers.push(timer);
  }

  if (options.fallbackText) {
    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      Promise.resolve(options.onFallback?.())
        .catch(() => {})
        .then(() => queueEdit(options.fallbackText, options.fallbackExtra, { terminal: true }))
        .catch(() => {});
    }, Math.max(10, Number(options.timeoutMs) || 20000));
    fallbackTimer.unref?.();
    timers.push(fallbackTimer);
  }

  return {
    placeholder,
    finish: (text, extra) => {
      if (settled) return null;
      settled = true;
      timers.forEach(clearTimeout);
      return queueEdit(text, extra, { terminal: true });
    },
    isSettled: () => settled,
  };
}

module.exports = {
  startAiPlaceholder,
  editPlaceholder,
  hasReplyKeyboard,
};
