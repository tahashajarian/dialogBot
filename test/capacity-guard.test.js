const test = require("node:test");
const assert = require("node:assert/strict");
const { CapacityError, createCapacityGuard } = require("../src/services/capacity-guard");

test("capacity guard bounds active work and drains its queue", async () => {
  const guard = createCapacityGuard({ concurrency: 1, maxQueue: 1, maxWaitMs: 100 });
  const first = await guard.acquire("user:1");
  const queued = guard.acquire("user:2");
  assert.deepEqual(guard.getState(), {
    active: 1, queued: 1, concurrency: 1, maxQueue: 1,
  });
  await assert.rejects(guard.acquire("user:3"), (error) => (
    error instanceof CapacityError && error.reason === "queue_full"
  ));
  first.release();
  const second = await queued;
  second.release();
  assert.equal(guard.getState().active, 0);
});

test("capacity guard rejects concurrent work for the same user", async () => {
  const guard = createCapacityGuard({ concurrency: 2, maxQueue: 2 });
  const lease = await guard.acquire("user:1");
  await assert.rejects(guard.acquire("user:1"), (error) => (
    error instanceof CapacityError && error.reason === "user_busy"
  ));
  lease.release();
  const next = await guard.acquire("user:1");
  next.release();
});

test("capacity guard releases its slot when work fails", async () => {
  const guard = createCapacityGuard({ concurrency: 1 });
  await assert.rejects(guard.run("", async () => {
    throw new Error("failed");
  }), /failed/);
  assert.equal(guard.getState().active, 0);
});
