const MAX_TRACKED_DELIVERIES = 500;

const deliveryByLocalMessage = new Map();

function getDeliveryKey(userId, messageId) {
  const normalizedUserId = Number(userId);
  const normalizedMessageId = Number(messageId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return "";
  if (!Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) return "";
  return `${normalizedUserId}:${normalizedMessageId}`;
}

function pruneOldDeliveries() {
  while (deliveryByLocalMessage.size > MAX_TRACKED_DELIVERIES) {
    const oldestKey = deliveryByLocalMessage.keys().next().value;
    if (!oldestKey) return;
    deliveryByLocalMessage.delete(oldestKey);
  }
}

function rememberDiscussionDelivery({ discussionId, deliveriesByUserId = {} } = {}) {
  const normalizedDiscussionId = String(discussionId || "");
  if (!normalizedDiscussionId) return null;

  const deliveries = {};
  Object.entries(deliveriesByUserId).forEach(([userId, messageId]) => {
    const normalizedUserId = Number(userId);
    const normalizedMessageId = Number(messageId);
    const isValidUserId = Number.isInteger(normalizedUserId) && normalizedUserId > 0;
    const isValidMessageId = Number.isInteger(normalizedMessageId) && normalizedMessageId > 0;
    if (isValidUserId && isValidMessageId) {
      deliveries[normalizedUserId] = normalizedMessageId;
    }
  });

  if (!Object.keys(deliveries).length) return null;

  const record = {
    discussionId: normalizedDiscussionId,
    deliveries,
  };

  Object.entries(deliveries).forEach(([userId, messageId]) => {
    deliveryByLocalMessage.set(getDeliveryKey(userId, messageId), record);
  });
  pruneOldDeliveries();
  return record;
}

function findDiscussionDelivery({ userId, messageId, discussionId = "" } = {}) {
  const record = deliveryByLocalMessage.get(getDeliveryKey(userId, messageId)) || null;
  if (!record) return null;
  if (discussionId && String(record.discussionId) !== String(discussionId)) return null;
  return record;
}

function getReplyMessageIdForRecipient(record, recipientUserId) {
  const normalizedUserId = Number(recipientUserId);
  if (!record?.deliveries || !Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return null;
  const messageId = Number(record.deliveries[normalizedUserId]);
  return Number.isInteger(messageId) && messageId > 0 ? messageId : null;
}

function clearDiscussionDeliveriesForTest() {
  deliveryByLocalMessage.clear();
}

module.exports = {
  clearDiscussionDeliveriesForTest,
  findDiscussionDelivery,
  getReplyMessageIdForRecipient,
  rememberDiscussionDelivery,
};
