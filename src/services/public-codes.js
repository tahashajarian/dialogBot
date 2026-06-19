const crypto = require("crypto");
const Discussion = require("../models/discussion");
const User = require("../models/user");

const PUBLIC_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generatePublicCodeSuffix(length) {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += PUBLIC_CODE_ALPHABET[crypto.randomInt(PUBLIC_CODE_ALPHABET.length)];
  }
  return suffix;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function normalizePublicProfileCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (!/^u_/i.test(raw)) return "";
  return `u_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

function normalizePublicDiscussionCode(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (!/^d_/i.test(raw)) return "";
  return `d_${raw.slice(2).replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

async function ensurePublicProfileCode(userId) {
  const user = await User.findOne({ userId });
  if (!user) return { ok: false, reason: "missing_user" };

  const current = normalizePublicProfileCode(user.publicProfileCode);
  if (current) return { ok: true, code: current, user };

  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = generatePublicCodeSuffix(4);
    code = `u_${suffix}`;
    try {
      const updated = await User.findOneAndUpdate(
        {
          userId,
          $or: [
            { publicProfileCode: "" },
            { publicProfileCode: null },
            { publicProfileCode: { $exists: false } },
          ],
        },
        { $set: { publicProfileCode: code } },
        { returnDocument: "after" },
      );

      if (updated) return { ok: true, code, user: updated };

      const refreshed = await User.findOne({ userId });
      const refreshedCode = normalizePublicProfileCode(refreshed?.publicProfileCode);
      if (refreshedCode) return { ok: true, code: refreshedCode, user: refreshed };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  return { ok: false, reason: "code_generation_failed" };
}

async function ensurePublicDiscussionCode(discussion) {
  const discussionId = discussion?._id || discussion;
  const current = normalizePublicDiscussionCode(discussion?.publicDiscussionCode);
  if (current) return { ok: true, code: current, discussion };

  const found = discussion?.title ? discussion : await Discussion.findById(discussionId);
  if (!found) return { ok: false, reason: "missing_discussion" };

  const existing = normalizePublicDiscussionCode(found.publicDiscussionCode);
  if (existing) return { ok: true, code: existing, discussion: found };

  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = generatePublicCodeSuffix(6);
    code = `d_${suffix}`;
    try {
      found.publicDiscussionCode = code;
      await found.save();
      return { ok: true, code, discussion: found };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      found.publicDiscussionCode = "";
    }
  }

  return { ok: false, reason: "code_generation_failed" };
}

async function ensurePublicDiscussionCodes(discussions = []) {
  await Promise.all((discussions || []).map((discussion) => ensurePublicDiscussionCode(discussion)));
  return discussions;
}

async function findDiscussionByPublicCode(code) {
  const cleanCode = normalizePublicDiscussionCode(code);
  if (!cleanCode) return null;
  return Discussion.findOne({ publicDiscussionCode: cleanCode });
}

async function getDiscussionInvitePreviewByCode(code) {
  const cleanCode = normalizePublicDiscussionCode(code);
  if (!cleanCode) return { ok: false, reason: "missing_discussion" };

  const discussion = await Discussion.findOne({ publicDiscussionCode: cleanCode });
  if (!discussion) return { ok: false, reason: "missing_discussion" };
  if (discussion.status !== "open") return { ok: false, reason: "discussion_closed", discussion };

  return { ok: true, discussion, code: cleanCode };
}

module.exports = {
  ensurePublicDiscussionCode,
  ensurePublicDiscussionCodes,
  ensurePublicProfileCode,
  findDiscussionByPublicCode,
  generatePublicCodeSuffix,
  getDiscussionInvitePreviewByCode,
  normalizePublicDiscussionCode,
  normalizePublicProfileCode,
};
