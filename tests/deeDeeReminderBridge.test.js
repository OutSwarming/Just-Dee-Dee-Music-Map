const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('web reminder module uses the spreadsheet bridge instead of a missing Firebase function', async () => {
    const calls = [];
    const context = {
        console,
        document: {
            addEventListener() {},
            getElementById() { return null; }
        }
    };
    context.window = context;
    context.BARK = {
        services: {
            spreadsheet: {
                async queueReminder(reminderId) {
                    calls.push(reminderId);
                    return { ok: true, status: 'pending' };
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, 'modules/deeDeeReminders.js'), 'utf8'),
        context,
        { filename: 'modules/deeDeeReminders.js' }
    );

    const result = await context.BARK.deeDeeReminders.sendReminder({ id: 'available-dates' });

    assert.deepEqual(calls, ['available-dates']);
    assert.equal(result.status, 'pending');
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'modules/deeDeeReminders.js'), 'utf8'), /httpsCallable|sendDeeDeeReminder/);
});

test('web reminder falls back to a working Messages composer on an older live bridge', async () => {
    const context = {
        console,
        encodeURIComponent,
        location: { href: '' },
        document: {
            addEventListener() {},
            getElementById() { return null; }
        }
    };
    context.window = context;
    context.BARK = {
        services: {
            spreadsheet: {
                async queueReminder() {
                    const error = new Error('Unknown action: queueReminder');
                    error.code = 'UNKNOWN_ACTION';
                    throw error;
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/deeDeeReminders.js'), 'utf8'), context);

    const result = await context.BARK.deeDeeReminders.sendReminder({
        id: 'follow-ups',
        label: 'Follow Ups',
        title: 'Polite nudge time'
    });

    assert.equal(result.manual, true);
    assert.match(context.location.href, /^sms:\+12168499292&body=/);
    assert.match(decodeURIComponent(context.location.href), /booking app/i);
});
