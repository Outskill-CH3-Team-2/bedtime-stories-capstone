
const CONFIG = {
    /** Base URL for the backend API. Change this to match your deployment. */
    API_BASE: 'http://localhost:8000',

    /** Polling interval for story status checks (ms) */
    POLL_INTERVAL: 2000,

    /** Maximum number of poll attempts before timing out */
    MAX_POLL_ATTEMPTS: 150,

    /** Duration of the intro book-opening animation (ms) */
    INTRO_DURATION: 3500,

    /** Duration of the page-turn transition (ms) */
    PAGE_TURN_DURATION: 500,
};




const StoryAPI = {
    /**
     * Start a new story session.
     * @param {string} childName - The child's first name
     * @param {number} childAge  - The child's age (3–8)
     * @param {string} prompt    - The scenario/event prompt from the parent
     * @returns {Promise<{session_id: string}>}
     */
    async startStory(childName, childAge, prompt) {
        // FIX(BUG3): Pass prompt alongside child config.
        // The current mock backend ignores extra fields, but a real backend will use it.
        const response = await fetch(`${CONFIG.API_BASE}/story/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                child_name: childName,
                child_age: childAge,
                prompt: prompt,
            }),
        });

        if (!response.ok) {
            const detail = await this._parseError(response);
            throw new Error(`Failed to start story: ${detail}`);
        }

        return response.json();
    },

    /**
     * Poll the status of a session.
     * @param {string} sessionId
     * @returns {Promise<{status: string}>}
     */
    async getStatus(sessionId) {
        const response = await fetch(
            `${CONFIG.API_BASE}/story/status/${encodeURIComponent(sessionId)}`
        );

        if (!response.ok) {
            const detail = await this._parseError(response);
            throw new Error(`Status check failed: ${detail}`);
        }

        return response.json();
    },

    /**
     * Fetch the completed story result (SceneOutput).
     * @param {string} sessionId
     * @returns {Promise<Object>} SceneOutput JSON
     */
    async getResult(sessionId) {
        const response = await fetch(
            `${CONFIG.API_BASE}/story/result/${encodeURIComponent(sessionId)}`
        );

        if (!response.ok) {
            const detail = await this._parseError(response);
            throw new Error(`Failed to fetch result: ${detail}`);
        }

        return response.json();
    },

    /**
     * Send the player's choice to continue the story.
     * @param {string} sessionId - Current session ID
     * @param {string} choiceId  - ID of the selected choice
     * @param {string} choiceText - Text of the selected choice
     * @returns {Promise<Object>}
     */
    async sendChoice(sessionId, choiceId, choiceText) {
        const response = await fetch(`${CONFIG.API_BASE}/story/choose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                choice_id: choiceId,
                choice_text: choiceText,
            }),
        });

        if (!response.ok) {
            const detail = await this._parseError(response);
            throw new Error(`Choice submission failed: ${detail}`);
        }

        return response.json();
    },

    /**
     * Poll the backend until the session status transitions to "complete" or "failed".
     * @param {string} sessionId
     * @param {function} [onStatusUpdate] - Optional callback receiving the current status string
     * @returns {Promise<void>} Resolves when status is "complete"
     * @throws {Error} When status is "failed" or max attempts reached
     */
    async pollUntilReady(sessionId, onStatusUpdate) {
        for (let attempt = 0; attempt < CONFIG.MAX_POLL_ATTEMPTS; attempt++) {
            const data = await this.getStatus(sessionId);
            const status = data.status;

            if (onStatusUpdate) {
                onStatusUpdate(status);
            }

            if (status === 'complete') {
                return;
            }

            if (status === 'failed') {
                throw new Error('Story generation failed. Please try again.');
            }

            // Wait before next poll
            await this._sleep(CONFIG.POLL_INTERVAL);
        }

        throw new Error('Story generation timed out. Please try again.');
    },

    /**
     * Helper: parse error response body.
     * @param {Response} response
     * @returns {Promise<string>}
     */
    async _parseError(response) {
        try {
            const body = await response.json();
            return body.detail || body.message || JSON.stringify(body);
        } catch {
            return `HTTP ${response.status}`;
        }
    },

    /**
     * Helper: async sleep.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};



const AudioController = {
    /** @type {HTMLAudioElement} */
    _audio: null,

    /** @type {HTMLButtonElement} */
    _activeBtn: null,

    /** @type {HTMLElement} */
    _activePlayer: null,

    /** Initialize with the page's <audio> element */
    init() {
        this._audio = document.getElementById('narration-audio');

        // Sync UI when audio ends
        this._audio.addEventListener('ended', () => {
            this._setPlaying(false);
        });

        this._audio.addEventListener('pause', () => {
            this._setPlaying(false);
        });

        this._audio.addEventListener('play', () => {
            this._setPlaying(true);
        });
    },

    /**
     * Load a base64-encoded audio clip and optionally auto-play.
     * @param {string} base64Audio - Base64-encoded audio (e.g. mp3)
     * @param {HTMLButtonElement} btn - The play/pause button element
     * @param {HTMLElement} playerEl - The .audio-player container element
     * @param {boolean} [autoPlay=false] - Attempt to auto-play
     */
    load(base64Audio, btn, playerEl, autoPlay = false) {
        this.stop();

        this._activeBtn = btn;
        this._activePlayer = playerEl;

        if (!base64Audio) {
            playerEl.classList.add('hidden');
            return;
        }

        playerEl.classList.remove('hidden');

        // Determine MIME type from the base64 header or default to mp3
        let mimeType = 'audio/mpeg';
        if (base64Audio.startsWith('data:')) {
            // Already a data URI
            this._audio.src = base64Audio;
        } else {
            this._audio.src = `data:${mimeType};base64,${base64Audio}`;
        }

        this._audio.load();

        if (autoPlay) {
            // Browser may block autoplay without a user gesture — that's okay
            this._audio.play().catch(() => { });
        }
    },

    /** Toggle play / pause */
    toggle() {
        if (!this._audio.src) return;

        if (this._audio.paused) {
            this._audio.play().catch(() => { });
        } else {
            this._audio.pause();
        }
    },

    /** Stop playback and reset */
    stop() {
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
            this._audio.removeAttribute('src');
        }
        this._setPlaying(false);
    },

    /**
     * Update button icon and waveform state.
     * @param {boolean} isPlaying
     */
    _setPlaying(isPlaying) {
        if (this._activeBtn) {
            this._activeBtn.textContent = isPlaying ? '⏸' : '▶';
            this._activeBtn.setAttribute(
                'aria-label',
                isPlaying ? 'Pause narration' : 'Play narration'
            );
        }
        if (this._activePlayer) {
            this._activePlayer.classList.toggle('is-playing', isPlaying);
        }
    },
};



const UIRenderer = {
    /* -- Cached DOM references (populated in init) -- */
    _els: {},

    /** Cache all frequently-accessed DOM elements */
    init() {
        this._els = {
            chapterNumber: document.getElementById('chapter-number'),
            storyText: document.getElementById('story-text'),
            illustrationWrapper: document.getElementById('illustration-wrapper'),
            storyIllustration: document.getElementById('story-illustration'),
            audioPlayer: document.getElementById('audio-player'),
            btnAudio: document.getElementById('btn-audio'),
            choicesContainer: document.getElementById('choices-container'),
            loadingStatus: document.getElementById('loading-status'),
            endStoryText: document.getElementById('end-story-text'),
            endIllWrapper: document.getElementById('end-illustration-wrapper'),
            endIllustration: document.getElementById('end-illustration'),
            endAudioPlayer: document.getElementById('end-audio-player'),
            btnEndAudio: document.getElementById('btn-end-audio'),
            errorMessage: document.getElementById('error-message'),
            particles: document.getElementById('particles'),
            pageTurnOverlay: document.getElementById('page-turn-overlay'),
        };
    },

    /**
     * Render a story chapter.
     * @param {Object} result     - SceneOutput from the API
     * @param {number} chapterNum - Chapter number to display
     */
    renderChapter(result, chapterNum) {
        const els = this._els;

        // Chapter badge
        els.chapterNumber.textContent = `Chapter ${chapterNum}`;

        // Illustration
        if (result.illustration_b64) {
            els.storyIllustration.src = this._toImageSrc(result.illustration_b64);
            els.illustrationWrapper.classList.remove('empty');
        } else {
            els.storyIllustration.src = '';
            els.illustrationWrapper.classList.add('empty');
        }

        // Story text
        els.storyText.textContent = result.story_text || '';

        // Audio
        AudioController.load(
            result.narration_audio_b64,
            els.btnAudio,
            els.audioPlayer,
            true // auto-play narration
        );

        // Choices
        this._renderChoices(result.choices || []);
    },

    /**
     * Render choice buttons.
     * @param {Array<{id: string, text: string, image_b64?: string}>} choices
     */
    _renderChoices(choices) {
        const container = this._els.choicesContainer;
        container.innerHTML = '';

        choices.forEach((choice, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn';
            btn.dataset.choiceId = choice.id;
            btn.dataset.choiceText = choice.text;
            btn.setAttribute('aria-label', `Choose: ${choice.text}`);

            // Choice icon
            const iconEl = document.createElement('span');
            iconEl.className = 'choice-icon';
            iconEl.setAttribute('aria-hidden', 'true');
            iconEl.textContent = index === 0 ? '🌿' : '🌊';
            btn.appendChild(iconEl);

            // Choice image (if available)
            if (choice.image_b64) {
                const img = document.createElement('img');
                img.className = 'choice-image';
                img.src = this._toImageSrc(choice.image_b64);
                img.alt = choice.text;
                img.loading = 'lazy';
                btn.appendChild(img);
            }

            // Choice text
            const textEl = document.createElement('span');
            textEl.className = 'choice-text';
            textEl.textContent = choice.text;
            btn.appendChild(textEl);

            container.appendChild(btn);
        });
    },

    /**
     * Render the ending state.
     * @param {Object} result - Final SceneOutput
     */
    renderEnd(result) {
        const els = this._els;

        // Story text
        els.endStoryText.textContent = result.story_text || '';

        // Illustration
        if (result.illustration_b64) {
            els.endIllustration.src = this._toImageSrc(result.illustration_b64);
            els.endIllWrapper.classList.remove('empty');
        } else {
            els.endIllustration.src = '';
            els.endIllWrapper.classList.add('empty');
        }

        // Audio
        AudioController.load(
            result.narration_audio_b64,
            els.btnEndAudio,
            els.endAudioPlayer,
            true
        );

        // Celebration particles
        this._spawnParticles();
    },

    /**
     * Update the loading status sub-text.
     * @param {string} status - Raw status from the API
     */
    updateLoadingStatus(status) {
        const statusMap = {
            pending: 'Preparing the magic…',
            generating_text: 'Writing your story…',
            safety_check: 'Making sure it\'s cozy and safe…',
            generating_media: 'Painting illustrations & recording narration…',
            processing: 'Preparing the magic…',
        };

        this._els.loadingStatus.textContent =
            statusMap[status] || 'Weaving your story…';
    },

    /**
     * Show an error message.
     * @param {string} message
     */
    renderError(message) {
        this._els.errorMessage.textContent =
            message || 'Something went wrong. Let\'s try again!';
    },

    /**
     * Disable all choice buttons and mark the selected one.
     * @param {string} choiceId
     */
    disableChoices(choiceId) {
        const buttons = this._els.choicesContainer.querySelectorAll('.choice-btn');
        buttons.forEach((btn) => {
            btn.disabled = true;
            if (btn.dataset.choiceId === choiceId) {
                btn.classList.add('selected');
            }
        });
    },

    /**
     * Play the page-turn transition overlay with proper fade-in / fade-out.
     * FIX(BUG7): Split into two phases so the overlay fully fades in before fading out.
     * @returns {Promise<void>} Resolves when the full transition completes
     */
    async pageTurn() {
        const overlay = this._els.pageTurnOverlay;
        overlay.classList.add('active');
        // Wait for fade-in (matches CSS transition duration)
        await this._sleep(CONFIG.PAGE_TURN_DURATION);
        overlay.classList.remove('active');
        // Wait for fade-out
        await this._sleep(CONFIG.PAGE_TURN_DURATION);
    },

    /**
     * Reset all dynamic UI content for a fresh start.
     */
    resetUI() {
        const els = this._els;
        els.storyText.textContent = '';
        els.storyIllustration.src = '';
        els.illustrationWrapper.classList.add('empty');
        els.choicesContainer.innerHTML = '';
        els.endStoryText.textContent = '';
        els.endIllustration.src = '';
        els.endIllWrapper.classList.add('empty');
        els.errorMessage.textContent = '';
        els.particles.innerHTML = '';
        els.loadingStatus.textContent = 'Preparing the magic…';

        // Reset form
        document.getElementById('start-form').reset();
        document.getElementById('btn-start').disabled = false;

        AudioController.stop();
    },

    /**
     * Spawn celebration particles in the END state.
     */
    _spawnParticles() {
        const container = this._els.particles;
        container.innerHTML = '';
        const emojis = ['⭐', '✨', '🌟', '💫', '🎉', '🌙', '💜'];

        for (let i = 0; i < 30; i++) {
            const el = document.createElement('div');
            el.className = 'particle';
            el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            el.style.left = `${Math.random() * 100}%`;
            el.style.animationDuration = `${3 + Math.random() * 4}s`;
            el.style.animationDelay = `${Math.random() * 3}s`;
            el.style.fontSize = `${1 + Math.random() * 1.5}rem`;
            container.appendChild(el);
        }
    },

    /**
     * Convert a base64 string to a usable image src.
     * Handles both raw base64 and data URIs.
     * @param {string} b64
     * @returns {string}
     */
    _toImageSrc(b64) {
        if (!b64) return '';
        if (b64.startsWith('data:')) return b64;
        return `data:image/png;base64,${b64}`;
    },

    /** Async sleep utility */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};




const StateMachine = {
    /** @type {string} Current state name */
    current: 'INIT',

    /** Valid transitions: { FROM_STATE: [TO_STATE, ...] } */
    _transitions: {
        INIT: ['INTRO_PLAYING', 'ERROR'],
        INTRO_PLAYING: ['LOADING_CHAPTER', 'ERROR'],
        LOADING_CHAPTER: ['SHOW_CHAPTER', 'END', 'ERROR'],
        SHOW_CHAPTER: ['LOADING_CHAPTER', 'END', 'ERROR'],
        END: ['INIT'],
        ERROR: ['INIT', 'LOADING_CHAPTER'],
    },

    /**
     * Transition to a new state.
     * @param {string} newState
     * @throws {Error} If the transition is invalid
     */
    transition(newState) {
        const valid = this._transitions[this.current];
        if (!valid || !valid.includes(newState)) {
            console.warn(
                `[StateMachine] Invalid transition: ${this.current} → ${newState}`
            );
            return;
        }

        console.log(`[StateMachine] ${this.current} → ${newState}`);
        this.current = newState;
        document.body.dataset.state = newState;
    },

    /** Force-set a state (bypass validation). Used during initialization. */
    forceSet(state) {
        this.current = state;
        document.body.dataset.state = state;
    },
};


/* ==========================================================================
   App — Orchestrator
   ==========================================================================

   Wires together the state machine, API, UI renderer, and audio controller.
   Handles the full user flow from start to end.
   ========================================================================== */

const App = {
    /** @type {string|null} Current session ID from the backend */
    _sessionId: null,

    /** @type {number} Current chapter number (1-indexed) */
    _chapterNumber: 0,

    /** @type {Object|null} Most recent SceneOutput */
    _currentResult: null,

    /** @type {string} User's prompt (scenario text) */
    _prompt: '',

    /**
     * Initialize the entire app.
     * Called once when the page loads.
     */
    init() {
        // Initialize subsystems
        UIRenderer.init();
        AudioController.init();
        StateMachine.forceSet('INIT');

        // Bind event listeners
        this._bindEvents();

        console.log('[App] Story Weaver initialized');
    },

    /** Bind all DOM event listeners */
    _bindEvents() {
        // Start form submission
        const startForm = document.getElementById('start-form');
        startForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this._handleStart();
        });

        // Audio play/pause (chapter)
        document.getElementById('btn-audio').addEventListener('click', () => {
            AudioController.toggle();
        });

        // Audio play/pause (end screen)
        document.getElementById('btn-end-audio').addEventListener('click', () => {
            AudioController.toggle();
        });

        // Choice selection (event delegation)
        document.getElementById('choices-container').addEventListener('click', (e) => {
            const btn = e.target.closest('.choice-btn');
            if (btn && !btn.disabled) {
                this._handleChoice(btn.dataset.choiceId, btn.dataset.choiceText);
            }
        });

        // New Adventure button
        document.getElementById('btn-new-adventure').addEventListener('click', () => {
            this._handleNewAdventure();
        });

        // Error retry button
        document.getElementById('btn-retry').addEventListener('click', () => {
            this._handleRetry();
        });

        // Error home button
        document.getElementById('btn-error-home').addEventListener('click', () => {
            this._handleNewAdventure();
        });
    },

    /**
     * Handle the "Start Story" button.
     * Validates input, triggers the intro animation, then starts generation.
     */
    async _handleStart() {
        const promptInput = document.getElementById('prompt-input');
        const nameInput = document.getElementById('child-name');
        const ageSelect = document.getElementById('child-age');
        const startBtn = document.getElementById('btn-start');

        const prompt = promptInput.value.trim();
        const childName = nameInput.value.trim();
        const childAge = parseInt(ageSelect.value, 10);

        // Validation
        if (!prompt || !childName || isNaN(childAge)) {
            return; // HTML5 validation will show built-in messages
        }

        // Disable the start button to prevent double-clicks
        startBtn.disabled = true;
        this._prompt = prompt;

        // Reset state for a fresh story
        this._sessionId = null;
        this._chapterNumber = 0;
        this._currentResult = null;

        try {
            // FIX(BUG4): Force-reset intro animation before showing it,
            // so replaying after "New Adventure" restarts the CSS keyframes.
            this._resetIntroAnimation();

            // Phase 1: Play intro animation
            StateMachine.transition('INTRO_PLAYING');

            // Phase 2: Start the backend story while the intro plays
            // FIX(BUG3): Pass the prompt to the API
            const startPromise = StoryAPI.startStory(childName, childAge, prompt);

            // Wait for the intro animation to finish
            await this._sleep(CONFIG.INTRO_DURATION);

            // Phase 3: Transition to loading
            StateMachine.transition('LOADING_CHAPTER');

            // Get the session ID from the start call
            const startResult = await startPromise;
            this._sessionId = startResult.session_id;

            // Phase 4: Poll until ready, then fetch result
            await this._pollAndRender();
        } catch (error) {
            console.error('[App] Start error:', error);
            this._showError(error.message);
        }
    },

    /**
     * Handle a choice button click.
     * Sends the choice, polls for the next chapter, and renders it.
     * @param {string} choiceId
     * @param {string} choiceText
     */
    async _handleChoice(choiceId, choiceText) {
        // Disable choices immediately
        UIRenderer.disableChoices(choiceId);
        AudioController.stop();

        try {
            // Short delay for the selection visual feedback
            await this._sleep(600);

            // Page turn transition
            await UIRenderer.pageTurn();

            // Transition to loading
            StateMachine.transition('LOADING_CHAPTER');

            // Send choice to backend
            await StoryAPI.sendChoice(this._sessionId, choiceId, choiceText);

            // Poll and render the next chapter
            await this._pollAndRender();
        } catch (error) {
            console.error('[App] Choice error:', error);
            this._showError(error.message);
        }
    },

    /**
     * Poll the backend for the current session, fetch the result, and render it.
     * Handles both regular chapters and endings.
     */
    async _pollAndRender() {
        try {
            // Poll until the story generation is complete
            await StoryAPI.pollUntilReady(this._sessionId, (status) => {
                UIRenderer.updateLoadingStatus(status);
            });

            // Fetch the result
            const result = await StoryAPI.getResult(this._sessionId);
            this._currentResult = result;
            this._chapterNumber++;

            // Page turn before showing the new chapter
            await UIRenderer.pageTurn();

            // Check if this is an ending
            if (result.is_ending) {
                UIRenderer.renderEnd(result);
                StateMachine.transition('END');
            } else {
                UIRenderer.renderChapter(result, this._chapterNumber);
                StateMachine.transition('SHOW_CHAPTER');

                // Scroll to top of the story
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (error) {
            console.error('[App] Poll/render error:', error);
            this._showError(error.message);
        }
    },

    /**
     * Handle "New Adventure" — full reset back to INIT.
     */
    _handleNewAdventure() {
        this._sessionId = null;
        this._chapterNumber = 0;
        this._currentResult = null;
        this._prompt = '';

        AudioController.stop();
        UIRenderer.resetUI();
        StateMachine.forceSet('INIT');

        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /**
     * Handle retry from the error state.
     * FIX(BUG6): Only attempt to resume polling if we have a valid session.
     * Otherwise, do a clean reset to INIT.
     */
    async _handleRetry() {
        if (this._sessionId) {
            try {
                // We have a session — try polling again
                StateMachine.transition('LOADING_CHAPTER');
                await this._pollAndRender();
            } catch (error) {
                console.error('[App] Retry error:', error);
                this._showError(error.message);
            }
        } else {
            // No session — go back to start
            this._handleNewAdventure();
        }
    },

    /**
     * Show the error state with a message.
     * @param {string} message
     */
    _showError(message) {
        UIRenderer.renderError(message);
        // Guard: only transition if ERROR is a valid target from current state
        if (StateMachine._transitions[StateMachine.current]?.includes('ERROR')) {
            StateMachine.transition('ERROR');
        } else {
            StateMachine.forceSet('ERROR');
        }
    },

    /**
     * FIX(BUG4): Force-reset the intro animation by cloning the book element.
     * CSS keyframes only replay when the element is re-inserted into the DOM.
     */
    _resetIntroAnimation() {
        const introSection = document.getElementById('state-intro');
        const bookEl = introSection.querySelector('.book-opening');
        if (bookEl) {
            const clone = bookEl.cloneNode(true);
            bookEl.parentNode.replaceChild(clone, bookEl);
        }
        // Also reset the intro text animation
        const introText = introSection.querySelector('.intro-text');
        if (introText) {
            const clone = introText.cloneNode(true);
            introText.parentNode.replaceChild(clone, introText);
        }
    },

    /** Async sleep utility */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};


/* --------------------------------------------------------------------------
   Bootstrap — Start the app when DOM is ready
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
