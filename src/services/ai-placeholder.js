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
  const placeholder = initialPlaceholder
    ? await editPlaceholder(ctx, initialPlaceholder, steps[0])
    : await ctx.reply(steps[0]);
  const timers = [];
  let settled = false;
  let editQueue = Promise.resolve(placeholder);

  const queueEdit = (text, extra, { terminal = false } = {}) => {
    editQueue = editQueue.then(() => {
      if (settled && !terminal) return placeholder;
      return editPlaceholder(ctx, placeholder, text, extra);
    });
    return editQueue;
  };

  for (let index = 1; index < steps.length; index += 1) {
    const configuredDelay = Array.isArray(options.stepDelays) ? Number(options.stepDelays[index - 1]) : NaN;
    const delayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : (index === 1 ? 2500 : 5500);
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
      queueEdit(options.fallbackText, options.fallbackExtra, { terminal: true }).catch(() => {});
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
  };
}

module.exports = {
  startAiPlaceholder,
  editPlaceholder,
};
