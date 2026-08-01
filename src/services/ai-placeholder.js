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
  const tryTerminalEdit = Boolean(options.tryTerminalEdit);
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

  const timers = [];
  let settled = false;
  let placeholderEditable = !disableEdits;
  let promoteProgressBeforeEdit = Boolean(
    options.ensureEditable
    && !disableEdits
    && hasReplyKeyboard(options.initialExtra),
  );
  const replaceProgress = Boolean(options.replaceProgress);
  const loopIntervalMs = Math.max(0, Number(options.loopIntervalMs) || 0);
  let loopTimer = null;
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
      // Telegram can reject edits to the message that removed the reply
      // keyboard. Replace it proactively on the first progress tick instead of
      // making a known-to-be-fragile API call that produces a warning. There is
      // still only one visible placeholder at any moment.
      if (promoteProgressBeforeEdit && !terminal) {
        promoteProgressBeforeEdit = false;
        const currentMessageId = getMessageId(placeholder);
        if (currentMessageId && ctx.deleteMessage) {
          try {
            await ctx.deleteMessage(currentMessageId);
          } catch (_) {
            // The replacement still restores visible progress if cleanup fails.
          }
        }
        const replacement = await ctx.reply(text, extra);
        if (getMessageId(replacement)) placeholder = replacement;
        placeholderEditable = true;
        return replacement;
      }

      const updated = await editPlaceholder(ctx, placeholder, text, extra, {
        deleteOnFallback: terminal,
        fallbackToReply: terminal,
        replaceOnUncertain: terminal,
        allowEdit: terminal && tryTerminalEdit ? true : placeholderEditable,
        onEditRejected: () => {
          placeholderEditable = false;
        },
      });
      if (getMessageId(updated)) placeholder = updated;
      return updated;
    });
    return editQueue;
  };

  if (loopIntervalMs > 0 && steps.length > 1) {
    let nextStepIndex = 1;
    const scheduleLoopStep = () => {
      loopTimer = setTimeout(() => {
        if (settled) return;
        const nextText = steps[nextStepIndex];
        nextStepIndex = (nextStepIndex + 1) % steps.length;
        queueEdit(nextText)
          .catch(() => {})
          .finally(() => {
            if (!settled) scheduleLoopStep();
          });
      }, loopIntervalMs);
      loopTimer.unref?.();
    };
    scheduleLoopStep();
  } else {
    for (let index = 1; index < steps.length; index += 1) {
      const configuredDelay = Array.isArray(options.stepDelays) ? Number(options.stepDelays[index - 1]) : NaN;
      const delayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 2500 + ((index - 1) * 3000);
      const timer = setTimeout(() => {
        if (settled) return;
        queueEdit(steps[index]).catch(() => {});
      }, delayMs);
      timers.push(timer);
    }
  }

  if (options.fallbackText) {
    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      if (loopTimer) clearTimeout(loopTimer);
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
      if (loopTimer) clearTimeout(loopTimer);
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
