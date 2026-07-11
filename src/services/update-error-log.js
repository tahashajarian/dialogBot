function resolveChatId(ctx) {
  return (
    ctx?.chat?.id ||
    ctx?.callbackQuery?.message?.chat?.id ||
    ctx?.update?.callback_query?.message?.chat?.id ||
    ctx?.message?.chat?.id ||
    ctx?.update?.message?.chat?.id
  );
}

function resolveUserId(ctx, user) {
  return (
    user?.userId ||
    ctx?.from?.id ||
    ctx?.message?.from?.id ||
    ctx?.message?.sender?.id ||
    ctx?.update?.message?.from?.id ||
    ctx?.update?.message?.sender?.id ||
    ctx?.callbackQuery?.from?.id ||
    ctx?.update?.callback_query?.from?.id ||
    ctx?.update?.callbackQuery?.from?.id
  );
}

function resolveUpdateType(ctx) {
  if (ctx?.callbackQuery || ctx?.update?.callback_query || ctx?.update?.callbackQuery) {
    return "callback_query";
  }
  if (ctx?.message || ctx?.update?.message) return "message";
  return "unknown";
}

function getCommandName(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("/")) return undefined;
  const command = value.split(/\s+/, 1)[0].split("?", 1)[0];
  const name = command.split("@", 1)[0];
  return /^\/[A-Za-z0-9_]+$/.test(name) ? name : undefined;
}

function getCallbackCategory(data) {
  const value = String(data || "").trim();
  if (!value) return undefined;
  const [category] = value.split(/[:|_\s]/, 1);
  return /^[A-Za-z0-9-]{1,40}$/.test(category) ? category : "unknown";
}

function serializeUpdateError(error) {
  if (!error || typeof error !== "object") {
    return {
      name: typeof error,
      message: String(error),
      stack: undefined,
    };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function buildUpdateErrorLogDetails({
  ctx,
  user,
  durationMs,
  stages,
  error,
} = {}) {
  const callbackData = (
    ctx?.callbackQuery?.data ||
    ctx?.update?.callback_query?.data ||
    ctx?.update?.callbackQuery?.data
  );
  const messageText = ctx?.message?.text || ctx?.update?.message?.text;
  const details = {
    userId: resolveUserId(ctx, user),
    chatId: resolveChatId(ctx),
    updateType: resolveUpdateType(ctx),
    userState: user?.state,
    durationMs,
    ...(stages && typeof stages === "object" ? { stages } : {}),
    error: serializeUpdateError(error),
  };

  const commandName = getCommandName(messageText);
  if (commandName) {
    details.commandName = commandName;
  }

  const callbackCategory = getCallbackCategory(callbackData);
  if (callbackCategory) {
    details.callbackCategory = callbackCategory;
  }

  return details;
}

module.exports = {
  buildUpdateErrorLogDetails,
  getCallbackCategory,
  getCommandName,
};
