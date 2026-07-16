function getMessageId(message) {
  return message?.message_id || message?.messageId;
}

async function editPlaceholder(ctx, placeholder, text, extra) {
  const messageId = getMessageId(placeholder);
  if (messageId && ctx.editMessageText) {
    const edited = await ctx.editMessageText(messageId, text, extra);
    if (edited) {
      return getMessageId(edited) ? edited : placeholder;
    }
  }

  if (messageId && ctx.deleteMessage) {
    await ctx.deleteMessage(messageId);
  }

  return ctx.reply(text, extra);
}

async function startAiPlaceholder(ctx, steps, options = {}) {
  const initialPlaceholder = options.placeholder || null;
  const retainSteps = Boolean(options.retainSteps);
  let placeholder;
  if (retainSteps && initialPlaceholder) {
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
    placeholder = await editPlaceholder(ctx, initialPlaceholder, steps[0], options.initialExtra);
  } else {
    placeholder = await ctx.reply(steps[0], options.initialExtra);
  }
  const timers = [];
  let settled = false;
  let editQueue = Promise.resolve(placeholder);

  const queueEdit = (text, extra, { terminal = false } = {}) => {
    editQueue = editQueue.then(() => {
      if (settled && !terminal) return placeholder;
      if (retainSteps) return ctx.reply(text, extra);
      return editPlaceholder(ctx, placeholder, text, extra);
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
};
