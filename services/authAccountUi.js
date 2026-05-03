/**
 * authAccountUi.js - Public account UI for Google and Email/Password auth.
 *
 * Full-access state remains read-only from the local entitlement service.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const MIN_PASSWORD_LENGTH = 8;

    let initialized = false;
    let activeMode = 'signin';
    let unsubscribePremium = null;

    function getElement(id) {
        return document.getElementById(id);
    }

    function getFirebaseAuth() {
        if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
            throw new Error('Firebase Auth is not available yet.');
        }
        return firebase.auth();
    }

    function getPremiumService() {
        return window.BARK.services && window.BARK.services.premium;
    }

    function requestGoogleAccountChooser() {
        const authService = window.BARK.services && window.BARK.services.auth;
        if (authService && typeof authService.requestGoogleAccountChooser === 'function') {
            authService.requestGoogleAccountChooser();
            return;
        }

        window.BARK.auth = window.BARK.auth || {};
        window.BARK.auth.forceGoogleAccountChooserOnNextSignIn = true;
    }

    function setText(id, text) {
        const node = getElement(id);
        if (node) node.textContent = text;
    }

    function setHidden(id, hidden) {
        const node = getElement(id);
        if (node) node.hidden = hidden === true;
    }

    function setStatus(message, tone = 'neutral') {
        const node = getElement('account-auth-message');
        if (!node) return;
        node.textContent = message || '';
        node.dataset.tone = tone;
        node.hidden = !message;
    }

    function cleanEmail(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function readPassword(id) {
        const input = getElement(id);
        return input && typeof input.value === 'string' ? input.value : '';
    }

    function validateEmail(email) {
        if (!EMAIL_PATTERN.test(email)) {
            return 'Enter a valid email address.';
        }
        return null;
    }

    function validatePassword(password) {
        if (password.length < MIN_PASSWORD_LENGTH) {
            return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        return null;
    }

    function getSafeAuthError(error) {
        const code = error && error.code ? String(error.code) : '';
        switch (code) {
            case 'auth/email-already-in-use':
                return 'That email already has an account. Sign in or reset your password.';
            case 'auth/invalid-email':
                return 'Enter a valid email address.';
            case 'auth/weak-password':
                return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-login-credentials':
            case 'auth/invalid-credential':
                return 'Email or password did not match.';
            case 'auth/operation-not-allowed':
                return 'Email/password sign-in is not enabled yet. Enable it in Firebase Console and try again.';
            case 'auth/too-many-requests':
                return 'Too many attempts. Wait a moment, then try again.';
            case 'auth/network-request-failed':
                return 'Network error. Check your connection and try again.';
            case 'auth/popup-closed-by-user':
                return 'Google sign-in was canceled.';
            default:
                return 'Sign-in could not be completed. Please try again.';
        }
    }

    function getProviderLabel(user) {
        const providerIds = (user && Array.isArray(user.providerData) ? user.providerData : [])
            .map(provider => provider && provider.providerId)
            .filter(Boolean);

        if (providerIds.includes('google.com') && providerIds.includes('password')) {
            return 'Google and email/password';
        }
        if (providerIds.includes('google.com')) return 'Google';
        if (providerIds.includes('password')) return 'Email/password';
        return user && user.isAnonymous ? 'Anonymous' : 'Firebase Auth';
    }

    function getPremiumLabel() {
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.getEntitlement !== 'function') {
            return 'Loading';
        }

        const entitlement = premiumService.getEntitlement();
        if (premiumService.isPremium && premiumService.isPremium()) {
            return entitlement.status === 'manual_active' ? 'Full access (manual)' : 'Full access';
        }
        return 'Full access';
    }

    function updateModeButtons() {
        ['signin', 'create', 'reset'].forEach(mode => {
            const button = getElement(`account-mode-${mode}`);
            if (!button) return;
            button.classList.toggle('active', activeMode === mode);
            button.setAttribute('aria-pressed', activeMode === mode ? 'true' : 'false');
        });
    }

    function showMode(mode, options = {}) {
        activeMode = ['signin', 'create', 'reset'].includes(mode) ? mode : 'signin';
        setHidden('account-signin-form', activeMode !== 'signin');
        setHidden('account-create-form', activeMode !== 'create');
        setHidden('account-reset-form', activeMode !== 'reset');
        updateModeButtons();
        setStatus('', 'neutral');

        if (options.focus === false) return;
        const target = activeMode === 'reset'
            ? getElement('account-reset-email')
            : getElement(activeMode === 'create' ? 'account-create-email' : 'account-signin-email');
        if (target) target.focus({ preventScroll: true });
    }

    function clearPasswordFields() {
        ['account-signin-password', 'account-create-password'].forEach(id => {
            const input = getElement(id);
            if (input) input.value = '';
        });
    }

    function refreshAccountDisplay() {
        let user = null;
        try {
            user = getFirebaseAuth().currentUser;
        } catch (error) {
            user = null;
        }

        const signedIn = Boolean(user);
        setHidden('account-status-card', !signedIn);

        if (!signedIn) return;

        setText('account-display-email', user.email || 'No email on this account');
        setText('account-display-uid', user.uid || 'Unavailable');
        setText('account-display-provider', getProviderLabel(user));
        setText('account-display-premium', getPremiumLabel());
    }

    async function createAccount(event) {
        event.preventDefault();
        const email = cleanEmail(getElement('account-create-email') && getElement('account-create-email').value);
        const password = readPassword('account-create-password');
        const validationError = validateEmail(email) || validatePassword(password);
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Creating account...', 'neutral');
            await getFirebaseAuth().createUserWithEmailAndPassword(email, password);
            clearPasswordFields();
            setStatus('Account created. You are signed in.', 'success');
        } catch (error) {
            console.error('[authAccountUi] createUserWithEmailAndPassword failed:', error);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function signInWithEmail(event) {
        event.preventDefault();
        const email = cleanEmail(getElement('account-signin-email') && getElement('account-signin-email').value);
        const password = readPassword('account-signin-password');
        const validationError = validateEmail(email) || (password ? null : 'Enter your password.');
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Signing in...', 'neutral');
            await getFirebaseAuth().signInWithEmailAndPassword(email, password);
            clearPasswordFields();
            setStatus('Signed in.', 'success');
        } catch (error) {
            console.error('[authAccountUi] signInWithEmailAndPassword failed:', error);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function sendPasswordReset(event) {
        event.preventDefault();
        const email = cleanEmail(getElement('account-reset-email') && getElement('account-reset-email').value);
        const validationError = validateEmail(email);
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Sending reset email...', 'neutral');
            await getFirebaseAuth().sendPasswordResetEmail(email);
            setStatus('Password reset email sent. Check your inbox.', 'success');
        } catch (error) {
            console.error('[authAccountUi] sendPasswordResetEmail failed:', error);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function signOut(options = {}) {
        try {
            await getFirebaseAuth().signOut();
            if (options.switchAccount) requestGoogleAccountChooser();
            clearPasswordFields();
            setStatus(options.switchAccount ? 'Signed out. Choose another account.' : 'Signed out.', 'success');
            showMode('signin');
            const loginContainer = getElement('login-container');
            if (loginContainer) loginContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            console.error('[authAccountUi] signOut failed:', error);
            setStatus('Sign-out could not be completed. Please try again.', 'error');
        }
    }

    function bindClick(id, handler) {
        const node = getElement(id);
        if (!node || node.dataset.accountBound === 'true') return;
        node.dataset.accountBound = 'true';
        node.addEventListener('click', handler);
    }

    function bindSubmit(id, handler) {
        const node = getElement(id);
        if (!node || node.dataset.accountBound === 'true') return;
        node.dataset.accountBound = 'true';
        node.addEventListener('submit', handler);
    }

    function subscribePremiumState() {
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.subscribe !== 'function' || unsubscribePremium) return;
        unsubscribePremium = premiumService.subscribe(refreshAccountDisplay);
    }

    function bindAuthObserverWhenReady(attempt = 0) {
        if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
            return;
        }

        try {
            firebase.auth().onAuthStateChanged(() => {
                refreshAccountDisplay();
            });
            refreshAccountDisplay();
        } catch (error) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
        }
    }

    function initAuthAccountUi() {
        if (initialized) return;
        initialized = true;

        bindClick('account-mode-signin', () => showMode('signin'));
        bindClick('account-mode-create', () => showMode('create'));
        bindClick('account-mode-reset', () => showMode('reset'));
        bindClick('account-forgot-password-btn', () => showMode('reset'));
        bindClick('account-inline-create-btn', () => showMode('create'));
        bindClick('account-signout-btn', () => signOut());
        bindClick('account-switch-btn', () => signOut({ switchAccount: true }));

        bindSubmit('account-signin-form', signInWithEmail);
        bindSubmit('account-create-form', createAccount);
        bindSubmit('account-reset-form', sendPasswordReset);

        showMode('signin', { focus: false });
        subscribePremiumState();
        bindAuthObserverWhenReady();
    }

    window.BARK.authAccountUi = {
        initAuthAccountUi,
        showMode,
        refreshAccountDisplay,
        signOut
    };
    window.BARK.initAuthAccountUi = initAuthAccountUi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuthAccountUi);
    } else {
        initAuthAccountUi();
    }
})();
