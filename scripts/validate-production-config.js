require("dotenv").config({ quiet: true });

const { getRuntimeConfig } = require("../src/config");
const { validateDashboardRuntimeSecurity } = require("../src/services/dashboard-security");

function validateProductionEnvironment(env = process.env, { dashboard = false } = {}) {
  const productionEnv = { ...env, NODE_ENV: "production" };
  getRuntimeConfig(productionEnv);
  if (dashboard) {
    validateDashboardRuntimeSecurity({
      token: productionEnv.ADMIN_DASHBOARD_TOKEN,
      host: productionEnv.ADMIN_DASHBOARD_HOST || "127.0.0.1",
      nodeEnv: "production",
    });
  }
  return true;
}

function main() {
  const dashboard = process.argv.includes("--dashboard");
  validateProductionEnvironment(process.env, { dashboard });
  process.stdout.write(
    `Production bot configuration is valid${dashboard ? ", including dashboard security" : ""}.\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validateProductionEnvironment };
