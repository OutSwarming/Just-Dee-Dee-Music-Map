/**
 * deeDeeReminders.js - automatic SMS reminder controls for Dee Dee.
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

    function setStatus(message, tone = 'neutral') {
        const status = document.getElementById('dee-dee-reminder-status');
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    }

    function getCallable(name) {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') {
            throw new Error('Firebase Functions is not available yet.');
        }
        return firebase.functions().httpsCallable(name);
    }

    async function sendReminder(reminder) {
        const callable = getCallable('sendDeeDeeReminder');
        const result = await callable({ reminderId: reminder.id });
        return result && result.data ? result.data : {};
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
            setStatus(`Sending ${reminder.label} reminder...`, 'neutral');
            sendReminder(reminder)
                .then(() => setStatus(`Sent ${reminder.label} reminder to Dee Dee.`, 'success'))
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
