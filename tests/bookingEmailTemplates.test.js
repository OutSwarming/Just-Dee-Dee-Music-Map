const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBookingModules() {
    const context = {
        console,
        Date,
        Map,
        Set,
        Promise,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        URLSearchParams
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    ['modules/bookingSchema.js', 'modules/bookingEmailTemplates.js'].forEach((relativePath) => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    return context.window.BARK;
}

test('first outreach template fills venue and artist details', () => {
    const bark = loadBookingModules();
    const templates = bark.bookingEmailTemplates;
    const rendered = templates.renderTemplate(undefined, {
        name: 'Brighten Brewing Company',
        city: 'Cuyahoga Falls',
        venueType: 'Brewery',
        booking: {
            contactName: 'Sam',
            contactEmail: 'sam@example.com'
        }
    });

    assert.equal(rendered.type, templates.TEMPLATE_TYPES.FIRST_OUTREACH);
    assert.equal(rendered.label, 'First Outreach');
    assert.match(rendered.subject, /Just Dee Dee Music/);
    assert.match(rendered.body, /Hi Sam,/);
    assert.match(rendered.body, /Brighten Brewing Company/);
    assert.match(rendered.body, /Brewery in Cuyahoga Falls/);
    assert.match(rendered.fullText, /^Subject: Live acoustic music booking inquiry/m);
});

test('suggested template switches to follow-up when a sent venue is due', () => {
    const bark = loadBookingModules();
    const booking = bark.bookingSchema.normalizeVenue({
        contactStatus: 'Sent',
        nextFollowUpDate: '2000-01-01',
        contactEmail: 'bookings@example.com'
    });
    const rendered = bark.bookingEmailTemplates.renderTemplate(undefined, {
        name: 'Follow Up Room',
        venueType: 'Pub/Bar',
        booking
    });

    assert.equal(rendered.type, bark.bookingEmailTemplates.TEMPLATE_TYPES.FOLLOW_UP);
    assert.match(rendered.subject, /Following up/);
    assert.match(rendered.body, /Follow Up Room/);
});

test('mailto draft encodes the selected email template without sending anything', () => {
    const bark = loadBookingModules();
    const href = bark.bookingEmailTemplates.getMailtoHref({
        name: 'Interested Winery',
        city: 'Madison',
        venueType: 'Winery',
        booking: {
            contactName: 'Taylor',
            contactEmail: 'taylor@example.com',
            contactStatus: bark.bookingSchema.CONTACT_STATUS.INTERESTED,
            isInterested: true
        }
    });

    assert.match(href, /^mailto:taylor%40example\.com\?/);

    const params = new URLSearchParams(href.split('?')[1]);
    assert.match(params.get('subject'), /Just Dee Dee Music/);
    assert.match(params.get('body'), /Hi Taylor,/);
    assert.match(params.get('body'), /possible dates for Interested Winery/);
});
