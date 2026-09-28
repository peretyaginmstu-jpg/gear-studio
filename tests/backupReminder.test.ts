import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRemindBackup } from '../lib/backupReminder.ts';

const now = new Date('2026-10-10T12:00:00Z'), ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

test('no reminder without work worth keeping', () => assert.equal(shouldRemindBackup({ hasWork: false, updatedAt: ago(0), now }), false));
test('never backed up → remind', () => assert.equal(shouldRemindBackup({ hasWork: true, updatedAt: ago(0), now }), true));
test('recent backup → quiet', () => assert.equal(shouldRemindBackup({ hasWork: true, updatedAt: ago(0), entry: { backedUpAt: ago(2) }, now }), false));
test('old backup and later changes → remind', () => assert.equal(shouldRemindBackup({ hasWork: true, updatedAt: ago(1), entry: { backedUpAt: ago(8) }, now }), true));
test('old backup without changes → quiet', () => assert.equal(shouldRemindBackup({ hasWork: true, updatedAt: ago(9), entry: { backedUpAt: ago(8) }, now }), false));
test('snooze wins', () => assert.equal(shouldRemindBackup({ hasWork: true, updatedAt: ago(0), entry: { snoozedUntil: ago(-3) }, now }), false));
