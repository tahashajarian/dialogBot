require("dotenv").config();

const axios = require("axios");
const { Telegraf } = require("telegraf");

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : "";
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/test-bale-pin.js --chat-id=<id> --message-id=<id> [--token=<bot_token>] [--api-root=<url>]",
      "",
      "Examples:",
      "  node scripts/test-bale-pin.js --chat-id=4595441 --message-id=1605",
      "  node scripts/test-bale-pin.js --chat-id=4595441 --message-id=1605 --api-root=https://tapi.bale.ai",
    ].join("\n"),
  );
}

function normalizeError(error) {
  return {
    code: Number(
      error?.code ||
      error?.response?.error_code ||
      error?.response?.data?.error_code,
    ) || null,
    description:
      error?.description ||
      error?.response?.description ||
      error?.response?.data?.description ||
      null,
    error:
      error?.message ||
      error?.response?.data?.error ||
      String(error),
    extra: {
      on: error?.on || null,
      status: error?.response?.status || null,
      data: error?.response?.data || null,
    },
  };
}

async function testViaTelegraf({ token, apiRoot, chatId, messageId }) {
  const bot = new Telegraf(token, {
    telegram: { apiRoot },
  });

  try {
    const result = await bot.telegram.callApi("pinChatMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function testViaHttp({ token, apiRoot, chatId, messageId }) {
  const base = apiRoot.replace(/\/+$/, "");
  const url = `${base}/bot${token}/pinChatMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      message_id: messageId,
    }, {
      timeout: 7000,
      headers: { "content-type": "application/json" },
    });
    return { ok: true, result: response.data };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function main() {
  const token = getArg("token") || process.env.BOT_TOKEN;
  const apiRoot = getArg("api-root") || process.env.API_ROOT || "https://tapi.bale.ai";
  const chatId = Number(getArg("chat-id"));
  const messageId = Number(getArg("message-id"));

  if (!token || !Number.isInteger(chatId) || !Number.isInteger(messageId) || chatId <= 0 || messageId <= 0) {
    printUsage();
    process.exit(1);
  }

  console.log("Running Bale pin diagnostics...");
  console.log({ apiRoot, chatId, messageId });

  const [telegrafResult, httpResult] = await Promise.all([
    testViaTelegraf({ token, apiRoot, chatId, messageId }),
    testViaHttp({ token, apiRoot, chatId, messageId }),
  ]);

  console.log("\nTelegraf callApi result:");
  console.log(JSON.stringify(telegrafResult, null, 2));

  console.log("\nDirect HTTP result:");
  console.log(JSON.stringify(httpResult, null, 2));

  if (!telegrafResult.ok && !httpResult.ok) {
    console.log("\nConclusion: both paths failed => likely Bale API/chat-context limitation.");
    process.exit(2);
  }

  if (telegrafResult.ok && !httpResult.ok) {
    console.log("\nConclusion: Telegraf path works but direct HTTP failed (check endpoint/payload/network).");
    process.exit(3);
  }

  if (!telegrafResult.ok && httpResult.ok) {
    console.log("\nConclusion: direct Bale HTTP works but Telegraf path failed (likely package/config behavior).");
    process.exit(4);
  }

  console.log("\nConclusion: both paths succeeded.");
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(10);
});
