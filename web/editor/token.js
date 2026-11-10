/**
 * Storage for the GitHub token.
 *
 * On Android, Capacitor Preferences would be the obvious choice, but it is
 * plain SharedPreferences, not encrypted; localStorage in the app's WebView
 * is equally private to the app. Neither protects against a rooted phone,
 * so use a fine-grained token limited to the one data repository.
 * Kept behind this small interface so it can move to an encrypted store later.
 */
const KEY = 'bandaid-editor.githubToken';

export function loadToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveToken(token) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* Storage unavailable: token lives only for this session. */
  }
}

export function forgetToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
