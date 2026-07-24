const { clearInterval, setInterval } = require("timers");
const { logger } = require("./logger");

function createPeriodicRefresh({
  name,
  refresh,
  intervalMs = 60_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  async function run() {
    if (running || stopped) return false;
    running = true;
    try {
      await refresh();
      return true;
    } catch (error) {
      logger.warn(`Failed to refresh ${name}; keeping cached values`, error);
      return false;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer || stopped) return;
      timer = setIntervalFn(() => {
        void run();
      }, intervalMs);
      timer?.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearIntervalFn(timer);
      timer = null;
    },
    run,
    getState() {
      return { running, started: Boolean(timer), stopped };
    },
  };
}

module.exports = {
  createPeriodicRefresh,
};
