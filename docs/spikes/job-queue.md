# Spike: background job queue

Date: 2026-09-20. Phase 0. Status: **working default (D-015), awaiting nothing further unless PM objects.**

## Question

The design allows no Redis. What runs background work (notification delivery with retry, overdue-fee reminders, approval reminders, payment-attempt checks, outbox draining) on PostgreSQL alone?

## Options

1. **Django's built-in Tasks framework** (`django.tasks`, Django 6.x). Django 6.1.1 ships only `immediate` and `dummy` backends. It defines an API but provides **no production worker**. A community PostgreSQL backend would be needed, and none is old enough to trust yet.
2. **Procrastinate 3.9.** A mature, PostgreSQL-native queue. It uses row locking, has built-in retry strategies, scheduled and periodic tasks, job locks, and a Django integration.

## Test

Ran Procrastinate 3.9.0 against the real PostgreSQL 17 with psycopg 3.

| Check | Result |
|---|---|
| A task that fails twice, with a 3-attempt retry strategy | Succeeded on attempt 3 |
| Second enqueue of the same `queueing_lock` while the first is waiting | Rejected (`AlreadyEnqueued`) |
| Both jobs end in status | `succeeded` |

## Recommendation (D-015)

Use **Procrastinate**, wrapped behind a thin `core.jobs` module so the rest of the code never imports it directly (it stays swappable, and Django's Tasks API remains an option later). Periodic work (daily overdue-fee run, two-day approval reminders, payment reconciliation) uses Procrastinate's periodic tasks.

Enqueue pattern: business writes and their **outbox event** are written in one database transaction. A job drains the outbox afterwards, so a crash between "saved" and "queued" cannot lose a notification. Unique keys on notification rows make retries safe.

## Notes

- **Windows development only:** psycopg's async mode does not work on Windows' default event loop. The worker must be started with a selector event loop. Linux (production and CI) is unaffected. Signal handling is skipped on Windows.
- Instantiate the Procrastinate app in a dedicated module, not `__main__`. The library warns otherwise.
- Not tested here: worker crash recovery under load, and the Django integration. Both belong to Phase 1 work, where the outbox is built.
