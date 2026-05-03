/**
 * paywallController.js - retired paywall compatibility shim.
 *
 * Just Dee Dee Music Live Map includes full access for every user.
 */
(function () {
    window.BARK = window.BARK || {};

    function openPaywall(options = {}) {
        console.info('[paywallController] Full access is included; no paywall is shown.', {
            source: options.source || 'unknown'
        });
        return false;
    }

    function closePaywall() {
        return false;
    }

    function init() {
        return true;
    }

    window.BARK.paywall = {
        init,
        openPaywall,
        closePaywall
    };
})();
