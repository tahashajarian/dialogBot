# Load testing

This repository includes a safe database workload test. It creates only temporary
documents in an explicitly isolated database and does not contact Telegram or the
AI provider.

Set `LOAD_TEST_MONGO_URI` to a staging MongoDB URI. The database name must contain
`loadtest`, which prevents accidental use of the production database.

```powershell
$env:LOAD_TEST_MONGO_URI="mongodb://localhost:27017"
$env:LOAD_TEST_DB_NAME="muze_loadtest"
npm.cmd run load:test -- --users=1000 --concurrency=100 --actions=5000
```

Run progressively with concurrency values of 50, 100, 250, 500, and 1000. The
command fails when errors reach 1% or database p95 latency reaches 500 ms.

Passing proves only that the core database update workload is healthy. Before a
production launch, also stage-test Telegram delivery and AI traffic because their
external rate limits cannot be safely simulated against real users.
