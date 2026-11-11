/**
 * THE theme bootstrap. One implementation, published in @wolffm/themes
 * (themes/src/theme-bootstrap.js in hadoku-task) and inlined verbatim into the
 * <head> of every page that wears a hadoku theme. Two ways to take it:
 *
 *   @wolffm/themes/theme-bootstrap.js  this file as text, for a sync script
 *   @wolffm/themes/theme-bootstrap     `THEME_BOOTSTRAP`, the same text as a
 *                                      string, for a build tool (Astro's
 *                                      `<script is:inline set:html={…}>`)
 *
 * Who inlines it today: hadoku_site (scripts/build/sync-theme-bootstrap.mjs,
 * into its five entry points, with `check:theme-bootstrap` failing on drift,
 * and /theme-bootstrap.js for edge-router's sign-in page) and hadoku-wiki
 * (its Starlight spaces).
 *
 * DO NOT COPY THIS SOMEWHERE ELSE. Edit here, publish, and every consumer
 * updates by bumping @wolffm/themes and re-syncing. Copy-paste is exactly how
 * this went wrong: five near-identical snippets, each with its own subset of
 * the behaviour, so which theme you got depended on which door you came in.
 *
 * It must stay safe to drop inside a <script> element as-is: no closing
 * script tag and no HTML comment opener anywhere in it, comments included.
 * test/theme-bootstrap.test.mjs fails if either appears.
 *
 * It assumes hadoku.me's own origin: it calls /session/whoami and
 * /prefs/api/v1/portfolio by relative URL, so a page on another origin paints
 * the right local theme but cannot remember() or adopt() across devices.
 *
 * WHY INLINE AND NOT A <script src>
 * ---------------------------------
 * This has to finish before the first paint or the page shows one theme and
 * swaps to another. A external script — even a blocking one — costs a round
 * trip in front of first paint. Inlining is the only way to be both early and
 * free, and single-sourcing it is why that doesn't mean five copies to
 * maintain.
 *
 * WHAT IT RESOLVES, IN ORDER
 * --------------------------
 *   1. sessionStorage['hadoku-theme'] — tab-local, freshest within a tab
 *   2. localStorage['hadoku-theme']   — survives a new tab / browser restart
 *   3. localStorage['hadoku-theme-auto'] — the random dark theme this device
 *      was dealt on its first visit (see WHO HAS NOT CHOSEN below)
 *   4. a fresh random dark theme, written to (3)
 *
 * That order is @wolffm/themes' own `loadTheme()`, and `saveTheme()` writes
 * both storage layers — so reading only one of them (which every copy of this
 * script did until 2026-08-07) silently ignores a saved theme.
 *
 * WHO HAS NOT CHOSEN
 * ------------------
 * Someone who has never touched a theme picker gets a dark theme at random —
 * every dark variant is in the draw, whatever the OS colour scheme says. The
 * draw is kept under its own key, never under `hadoku-theme`: it is sticky so
 * the theme does not change from page to page, but it is not a choice, and
 * `hadoku-theme` is what every reader takes as one.
 *
 * Touching a picker ends the draw for good — including picking light. Locally
 * that is `hadoku-theme` being written; across devices it is the `theme` field
 * of the `portfolio` prefs row, which every picker writes at BOTH scopes (user
 * scope so a new device inherits the last pick, device scope so "dark on the
 * phone, light on the desktop" still holds). The row CANNOT be read here — it
 * is a network hop and this runs before paint — so a device still on its draw
 * adopts it after mount: @wolffm/themes in the apps, `adopt()` below on the
 * frontpage. That one-time swap on a new device is the only theme change that
 * survives this script.
 *
 * WHAT IT PUBLISHES
 * -----------------
 * `window.__hadokuTheme` — the decision, so nothing has to re-derive it:
 *   theme       fully-qualified name already applied to <html>
 *   chosen      true when it came from storage (a real choice) rather than the
 *               random draw. Callers must not persist an unchosen value into
 *               the durable layer — that is how the frontpage shell used to
 *               overwrite a theme the user had picked inside an app.
 *   prefersDark the OS preference, already resolved
 *   normalize() expand a stored value to a real theme name
 *   apply()     set/remove the attribute per the light = no attribute rule
 *   persist()   write storage the way @wolffm/themes' saveTheme() does
 *   remember()  record a picker choice in prefs-api, so other devices stop
 *               drawing. For a page with no @wolffm/themes picker only.
 *   adopt(cb)   still on the draw? fetch a choice made on another device and,
 *               if there is one, apply + persist it and call cb(theme).
 */
(function () {
	var KEY = 'hadoku-theme';
	var AUTO_KEY = 'hadoku-theme-auto';
	// Every dark variant @wolffm/themes ships. test/theme-bootstrap.test.mjs
	// fails when the package adds or drops one and this list does not follow.
	var DARK_THEMES = [
		'dark',
		'ocean-dark',
		'cyberpunk-dark',
		'coffee-dark',
		'lavender-dark',
		'nature-dark',
		'pink-dark',
		'izakaya-dark',
	];
	// Themes the package no longer ships, mapped to their replacement. Mirrors
	// RETIRED_THEMES in @wolffm/themes; test/theme-bootstrap.test.mjs
	// fails when the two differ. A retired name applied as-is matches no CSS.
	var RETIRED = {
		strawberry: 'pink',
		'strawberry-light': 'pink-light',
		'strawberry-dark': 'pink-dark',
	};
	var PREFS_URL = '/prefs/api/v1/portfolio';
	var DEVICE_ID_KEY = 'hadoku_device_id';

	var prefersDark = !!(
		window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	);

	/**
	 * Expand a stored value to a fully-qualified theme name, or null if it is
	 * not one. Mirrors normalizeThemeName() in @wolffm/themes.
	 *
	 * The bare FAMILY TOKEN case ('coffee' rather than 'coffee-light') is real:
	 * a surface may store just the family and leave light/dark to whoever reads
	 * it. A bare token is not a theme name, so applying it unexpanded matches no
	 * CSS at all and the page renders untinted.
	 */
	function normalize(value) {
		var raw = (value == null ? '' : String(value)).trim();
		if (!raw) return null;
		if (Object.prototype.hasOwnProperty.call(RETIRED, raw)) raw = RETIRED[raw];
		if (raw === 'light' || raw === 'dark') return raw;
		if (/-(?:light|dark)$/.test(raw)) return raw;
		return raw + (prefersDark ? '-dark' : '-light');
	}

	/** light is the ABSENCE of the attribute — the :root default. */
	function apply(theme) {
		if (theme === 'light') document.documentElement.removeAttribute('data-theme');
		else document.documentElement.setAttribute('data-theme', theme);
	}

	/**
	 * sessionStorage always; localStorage only for a real choice. The layers
	 * mean different things — localStorage is what a NEW TAB inherits, so
	 * writing a default there overrides a theme chosen elsewhere.
	 */
	function persist(theme, durable) {
		try {
			sessionStorage.setItem(KEY, theme);
			if (durable) localStorage.setItem(KEY, theme);
		} catch (e) {
			/* private mode / blocked cookies — the attribute still applies */
		}
	}

	var fromSession = null;
	var fromLocal = null;
	var dealtRaw = null;
	try {
		fromSession = normalize(sessionStorage.getItem(KEY));
		fromLocal = normalize(localStorage.getItem(KEY));
		dealtRaw = localStorage.getItem(AUTO_KEY);
	} catch (e) {
		/* storage blocked — the draw below still paints, it just is not kept */
	}

	// Normalized like everything else, so a draw of a since-retired theme is
	// still the draw (as its replacement) and its echo is still not a choice.
	var dealt = normalize(dealtRaw);
	var stored = fromSession || fromLocal;
	// The draw echoed back into the tab-local layer (the frontpage shell
	// broadcasts what it painted, and the layers write it there) is still the
	// draw. Treating it as a choice would end the draw without a picker touched.
	var chosen = !!fromLocal || (!!fromSession && fromSession !== dealt);
	var theme = stored;
	if (!theme) {
		// A draw from before the package dropped a theme is drawn again.
		theme =
			DARK_THEMES.indexOf(dealt) >= 0
				? dealt
				: DARK_THEMES[Math.floor(Math.random() * DARK_THEMES.length)];
		if (theme !== dealtRaw) {
			try {
				localStorage.setItem(AUTO_KEY, theme);
			} catch (e) {
				/* storage blocked — a new draw on the next load */
			}
		}
	}
	apply(theme);

	// Promote a durable-only value into the tab-local layer, so everything that
	// reads sessionStorage first agrees with what was just painted. Only when it
	// came from localStorage: writing the fallback here would make "nothing
	// chosen" indistinguishable from a deliberate choice, and both this script
	// and @wolffm/themes' themePrefs depend on telling those apart.
	if (!fromSession && fromLocal) persist(fromLocal, false);

	var boot = {
		theme: theme,
		chosen: chosen,
		prefersDark: prefersDark,
		normalize: normalize,
		apply: apply,
		persist: persist,
	};

	/**
	 * prefs-api serves member tier and up; for anyone below that every call is
	 * a foregone 401 in the console, so ask once who this is first.
	 */
	var signedIn = null;
	function whenSignedIn(fn) {
		if (!signedIn) {
			signedIn = fetch('/session/whoami', { credentials: 'include' })
				.then(function (r) {
					return r.json();
				})
				.then(function (j) {
					return !!j && !!j.userType && j.userType !== 'public';
				})
				.catch(function () {
					return false;
				});
		}
		signedIn.then(function (yes) {
			if (yes) fn();
		});
	}

	/** @wolffm/prefs-client's getDeviceId(), so both write the same device row. */
	function deviceId() {
		var id = localStorage.getItem(DEVICE_ID_KEY);
		if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
			id = crypto.randomUUID();
			localStorage.setItem(DEVICE_ID_KEY, id);
		}
		return id;
	}

	/** fetch() with the device header — a blocked localStorage rejects, not throws. */
	function prefsFetch(init) {
		return Promise.resolve().then(function () {
			init.credentials = 'include';
			init.headers = init.headers || {};
			init.headers['X-Device-Id'] = deviceId();
			return fetch(PREFS_URL, init);
		});
	}

	function put(scope, value) {
		return prefsFetch({
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scope: scope, patch: { theme: value } }),
		}).then(function (r) {
			if (!r.ok) throw new Error('prefs-api PUT ' + scope + ' ' + r.status);
		});
	}

	function remember(value) {
		boot.chosen = true;
		whenSignedIn(function () {
			Promise.all([put('user', value), put('device', value)]).catch(function (err) {
				console.error('[theme-bootstrap] saving the theme choice failed', {
					error: (err && err.message) || String(err),
					theme: value,
				});
			});
		});
	}

	function adopt(cb) {
		if (boot.chosen) return;
		whenSignedIn(function () {
			prefsFetch({})
				.then(function (r) {
					if (!r.ok) throw new Error('prefs-api GET ' + r.status);
					return r.json();
				})
				.then(function (body) {
					var picked = normalize(body && body.merged && body.merged.theme);
					// A pick made on this page while the fetch was out wins.
					if (!picked || boot.chosen) return;
					boot.chosen = true;
					boot.theme = picked;
					apply(picked);
					persist(picked, true);
					cb(picked);
				})
				.catch(function (err) {
					console.error('[theme-bootstrap] reading the theme choice failed', {
						error: (err && err.message) || String(err),
					});
				});
		});
	}

	boot.remember = remember;
	boot.adopt = adopt;
	window.__hadokuTheme = boot;
})();
