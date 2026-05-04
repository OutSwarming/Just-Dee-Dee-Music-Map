/**
 * bookingEmailTemplates.js - reusable no-AI booking outreach templates.
 */
(function () {
    window.BARK = window.BARK || {};

    const TEMPLATE_TYPES = Object.freeze({
        FIRST_OUTREACH: 'firstOutreach',
        FOLLOW_UP: 'followUp',
        INTERESTED_REPLY: 'interestedReply',
        REBOOKING: 'rebooking',
        THANK_YOU: 'thankYou',
        PRIVATE_EVENT_REPLY: 'privateEventReply'
    });

    const ARTIST = Object.freeze({
        name: 'Just Dee Dee Music',
        phone: '440-628-1508',
        email: 'JustDeeDeeMusic@gmail.com',
        website: 'https://www.justdeedeemusic.com/',
        description: 'acoustic rock, pop, country, and folk covers'
    });

    const TEMPLATES = Object.freeze({
        [TEMPLATE_TYPES.FIRST_OUTREACH]: {
            label: 'First Outreach',
            subject: 'Live acoustic music booking inquiry - {{artistName}}',
            body: [
                'Hi {{contactName}},',
                '',
                'I am reaching out on behalf of {{artistName}}. Dee Dee performs {{artistDescription}} across Northeast Ohio, with a flexible setlist that works well for breweries, wineries, restaurants, festivals, coffee shops, pubs, and private events.',
                '',
                'I saw {{venueName}} is a {{venueType}} in {{city}} and thought Dee Dee could be a strong fit for an upcoming date.',
                '',
                'Would you be the right person to ask about booking availability?',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        },
        [TEMPLATE_TYPES.FOLLOW_UP]: {
            label: 'Follow-Up',
            subject: 'Following up - {{artistName}} booking inquiry',
            body: [
                'Hi {{contactName}},',
                '',
                'I wanted to follow up on my note about booking {{artistName}} for live acoustic music at {{venueName}}.',
                '',
                'Dee Dee performs acoustic rock, pop, country, and folk covers across Northeast Ohio and can tailor the set for {{venueType}} audiences.',
                '',
                'Is there someone I should connect with about upcoming availability?',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        },
        [TEMPLATE_TYPES.INTERESTED_REPLY]: {
            label: 'Interested Reply',
            subject: 'Re: {{artistName}} availability for {{venueName}}',
            body: [
                'Hi {{contactName}},',
                '',
                'Thank you for getting back to me. Dee Dee would love to talk through possible dates for {{venueName}}.',
                '',
                'What dates or time slots are you currently looking to fill?',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        },
        [TEMPLATE_TYPES.REBOOKING]: {
            label: 'Rebooking',
            subject: 'Future live music dates - {{artistName}} at {{venueName}}',
            body: [
                'Hi {{contactName}},',
                '',
                'I wanted to check in about future live music dates at {{venueName}}.',
                '',
                'Dee Dee would be happy to return with acoustic rock, pop, country, and folk covers for another date that fits your calendar.',
                '',
                'Are you booking any upcoming openings?',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        },
        [TEMPLATE_TYPES.THANK_YOU]: {
            label: 'Thank You',
            subject: 'Thank you from {{artistName}}',
            body: [
                'Hi {{contactName}},',
                '',
                'Thank you for having Dee Dee at {{venueName}}. It was a pleasure to be part of the music lineup.',
                '',
                'Please keep {{artistName}} in mind for future dates.',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        },
        [TEMPLATE_TYPES.PRIVATE_EVENT_REPLY]: {
            label: 'Private Event Reply',
            subject: '{{artistName}} private event inquiry',
            body: [
                'Hi {{contactName}},',
                '',
                'Thank you for reaching out about a private event. Dee Dee performs acoustic rock, pop, country, and folk covers and can shape the set around the room, timing, and audience.',
                '',
                'Could you send the event date, location, approximate time, and expected length of the performance?',
                '',
                'Thank you,',
                'Dee Dee',
                '{{artistName}}',
                '{{artistPhone}}',
                '{{artistEmail}}',
                '{{artistWebsite}}'
            ].join('\n')
        }
    });

    function clean(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function getSchema() {
        return window.BARK.bookingSchema;
    }

    function buildContext(venue = {}) {
        const booking = venue.booking || {};
        return {
            venueName: clean(venue.name) || 'your venue',
            contactName: clean(booking.contactName || venue.contactName) || 'there',
            venueType: clean(venue.venueType || venue.category) || 'venue',
            city: clean(venue.city) || 'Northeast Ohio',
            bookingUrl: clean(booking.bookingUrl || venue.bookingUrl),
            website: clean(venue.website || booking.website),
            phone: clean(booking.contactPhone || venue.contactPhone),
            email: clean(booking.contactEmail || venue.contactEmail),
            artistName: ARTIST.name,
            artistPhone: ARTIST.phone,
            artistEmail: ARTIST.email,
            artistWebsite: ARTIST.website,
            artistDescription: ARTIST.description
        };
    }

    function interpolate(template, context) {
        return clean(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
            return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : '';
        });
    }

    function getSuggestedTemplateType(venue = {}) {
        const schema = getSchema();
        const status = clean((venue.booking && venue.booking.contactStatus) || venue.contactStatus);
        const statuses = schema && schema.CONTACT_STATUS ? schema.CONTACT_STATUS : {};

        if ((venue.booking && venue.booking.isInterested) || status === statuses.INTERESTED) {
            return TEMPLATE_TYPES.INTERESTED_REPLY;
        }
        if ((venue.booking && venue.booking.isBooked) || status === statuses.BOOKED) {
            return TEMPLATE_TYPES.REBOOKING;
        }
        if (
            (venue.booking && venue.booking.isFollowUpDue) ||
            status === statuses.SENT ||
            status === statuses.FOLLOW_UP_NEEDED ||
            status === statuses.NO_RESPONSE
        ) {
            return TEMPLATE_TYPES.FOLLOW_UP;
        }
        if (venue.booking && venue.booking.isPrivateEvent) {
            return TEMPLATE_TYPES.PRIVATE_EVENT_REPLY;
        }
        return TEMPLATE_TYPES.FIRST_OUTREACH;
    }

    function getTemplateOptions() {
        return Object.keys(TEMPLATES).map(type => ({
            type,
            label: TEMPLATES[type].label
        }));
    }

    function renderTemplate(type, venue = {}) {
        const templateType = TEMPLATES[type] ? type : getSuggestedTemplateType(venue);
        const template = TEMPLATES[templateType];
        const context = buildContext(venue);
        const subject = interpolate(template.subject, context);
        const body = interpolate(template.body, context);

        return {
            type: templateType,
            label: template.label,
            subject,
            body,
            fullText: [`Subject: ${subject}`, '', body].join('\n')
        };
    }

    function getMailtoHref(venue = {}, type) {
        const booking = venue.booking || {};
        const email = clean(booking.contactEmail || venue.contactEmail);
        if (!email) return '';

        const rendered = renderTemplate(type || getSuggestedTemplateType(venue), venue);
        const params = new URLSearchParams({
            subject: rendered.subject,
            body: rendered.body
        });
        return `mailto:${encodeURIComponent(email)}?${params.toString()}`;
    }

    window.BARK.bookingEmailTemplates = {
        ARTIST,
        TEMPLATE_TYPES,
        TEMPLATES,
        buildContext,
        getTemplateOptions,
        getSuggestedTemplateType,
        renderTemplate,
        getMailtoHref
    };
})();
