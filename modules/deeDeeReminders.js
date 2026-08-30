/**
 * deeDeeReminders.js - queue reminder controls for the local Messages worker.
 */
(function () {
    window.BARK = window.BARK || {};

    const REMINDERS = Object.freeze([
        {
            id: 'today-plan',
            label: 'Plan Today',
            title: 'Booking brain check'
        },
        {
            id: 'available-dates',
            label: 'Check Dates',
            title: 'Open date scout'
        },
        {
            id: 'follow-ups',
            label: 'Follow Ups',
            title: 'Polite nudge time'
        },
        {
            id: 'calendar-cleanup',
            label: 'Calendar Sync',
            title: 'Calendar tidy-up'
        }
    ]);
    const DEE_DEE_PHONE = '+12168499292';
    const APP_URL = 'https://outswarming.github.io/Just-Dee-Dee-Music-Map/';

    function setStatus(message, tone = 'neutral') {
        const status = document.getElementById('dee-dee-reminder-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    async function sendReminder(reminder) {
        const spreadsheet = window.BARK
            && window.BARK.services
            && window.BARK.services.spreadsheet;
        if (!spreadsheet || typeof spreadsheet.queueReminder !== 'function') {
            throw new Error('The reminder bridge is not ready yet. Refresh the app and try again.');
        }
        try {
            return await spreadsheet.queueReminder(reminder.id);
        } catch (error) {
            if (!error || error.code !== 'UNKNOWN_ACTION') throw error;
            const body = `Hey Dee Dee! ${reminder.title}: open the booking app and take care of ${reminder.label.toLowerCase()}.\n\n${APP_URL}`;
            window.location.href = `sms:${DEE_DEE_PHONE}&body=${encodeURIComponent(body)}`;
            return { ok: true, status: 'manual', manual: true };
        }
    }

    function renderReminderButtons() {
        const list = document.getElementById('dee-dee-reminder-list');
        if (!list) return false;
        list.innerHTML = REMINDERS.map(reminder => `
            <button type="button" class="dee-dee-reminder-btn" data-reminder-id="${reminder.id}">
                <span>${reminder.label}</span>
                <strong>${reminder.title}</strong>
                <small>Send now</small>
            </button>
        `).join('');
        return true;
    }

    function setButtonBusy(button, isBusy) {
        if (!button) return;
        button.disabled = Boolean(isBusy);
        button.classList.toggle('is-busy', Boolean(isBusy));
    }

    function init() {
        const list = document.getElementById('dee-dee-reminder-list');
        if (!list || init.bound) return;
        init.bound = true;
        renderReminderButtons();
        list.addEventListener('click', event => {
            const button = event.target && event.target.closest ? event.target.closest('[data-reminder-id]') : null;
            if (!button || !list.contains(button)) return;
            const reminder = REMINDERS.find(item => item.id === button.dataset.reminderId);
            if (!reminder) return;

            setButtonBusy(button, true);
            setStatus(`Queueing ${reminder.label} reminder...`, 'neutral');
            sendReminder(reminder)
                .then(result => setStatus(
                    result && result.manual
                        ? `Opened Messages with the ${reminder.label} reminder ready to send.`
                        : result && result.status === 'sent'
                            ? `Sent ${reminder.label} reminder to Dee Dee.`
                            : `${reminder.label} is queued and will send within five minutes.`,
                    'success'
                ))
                .catch(error => {
                    console.error('[deeDeeReminders] send failed:', error);
                    setStatus(error && error.message ? error.message : 'Automatic reminder sending is not configured yet.', 'error');
                })
                .finally(() => setButtonBusy(button, false));
        });
    }

    window.BARK.deeDeeReminders = {
        REMINDERS,
        init,
        sendReminder
    };

    document.addEventListener('DOMContentLoaded', init);
})();
