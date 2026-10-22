import { AuditLog } from "./audit";
import { loadConfig } from "./config";
import { connect } from "./db";
import { httpClient } from "./http";
import { handlers } from "./jobs/handlers";
import { runOnce } from "./jobs/worker";
import { consoleLogger } from "./log";
import { Gateway } from "./payments/gateway";

const config = loadConfig();
const db = connect(config.databaseUrl);
const audit = new AuditLog(db, consoleLogger);
const gateway = new Gateway(httpClient(config.gatewayUrl), config.gatewayKey);
const table = handlers({ db, gateway, audit, config });

for (;;) {
  const ran = await runOnce(db, table, consoleLogger);
  if (!ran) await new Promise((r) => setTimeout(r, 1_000));
}
