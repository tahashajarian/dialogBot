const REFRESH_MS = 4000;

function startHomeThinking(ctx, deps = {}) {
  const send = deps.sendChatAction || ctx.sendChatAction;
  if (typeof send !== "function") return () => {};

  let stopped = false;
  const emit = () => {
    if (stopped) return;
    Promise.resolve(send("typing")).catch(() => {});
  };

  emit();
  const timer = globalThis.setInterval(emit, deps.refreshMs || REFRESH_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    globalThis.clearInterval(timer);
  };
}

module.exports = { REFRESH_MS, startHomeThinking };
