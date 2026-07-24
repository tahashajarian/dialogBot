const { createCapacityGuard } = require("./capacity-guard");

const aiCapacity = createCapacityGuard({
  concurrency: 8,
  maxQueue: 16,
  maxWaitMs: 1500,
});

const notificationCapacity = createCapacityGuard({
  concurrency: 32,
  maxQueue: 128,
  maxWaitMs: 1000,
});

module.exports = {
  aiCapacity,
  notificationCapacity,
};
