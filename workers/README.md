# workers/

Background jobs (email sync, reminder notifications, monthly net-worth
snapshots) live here. They are added in Phases 5, 7 and 8 and are invoked by a
scheduler (cron / `node` script) — never from the browser.
