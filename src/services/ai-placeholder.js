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

async function startAiPlaceholder(ctx, steps) {
  const placeholder = await ctx.reply(steps[0]);
  const timers = [];

  for (let index = 1; index < steps.length; index += 1) {
    const delayMs = index === 1 ? 2500 : 5500;
    const timer = setTimeout(() => {
      editPlaceholder(ctx, placeholder, steps[index]).catch(() => {});
    }, delayMs);
    timers.push(timer);
  }

  return {
    placeholder,
    finish: (text, extra) => {
      timers.forEach(clearTimeout);
      return editPlaceholder(ctx, placeholder, text, extra);
    },
  };
}

module.exports = {
  startAiPlaceholder,
  editPlaceholder,
};
