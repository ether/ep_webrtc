import {Page} from '@playwright/test';

// Generator that yields the Cartesian product of the given iterables.
// 1:1 port of the legacy utils.js cartesian generator.
export function* cartesian<T>(head: T[], ...tail: T[][]): Generator<T[]> {
  const remainder: Iterable<T[]> = tail.length > 0 ? cartesian(tail[0], ...tail.slice(1)) : [[]];
  for (const r of remainder) for (const h of head) yield [h, ...r];
}

// Installs a fake navigator.mediaDevices.getUserMedia inside the page.
//
// Implementation note: the legacy helper depended on document/AudioContext
// at the time of installation (it created the canvas + AudioContext inside
// the pad's chrome window). The Playwright equivalent runs the entire
// install inside page.evaluate() so canvas/AudioContext live in browser
// context, matching the old behavior 1:1.
//
// If `track` is true, the function also sets `window.__webrtcLastStream`
// and `window.__webrtcLastConstraints` on every getUserMedia call so the
// caller can inspect the most recent audio/video tracks (used by the
// interface_buttons spec which originally captured the tracks via
// closure variables in the helper).
export const installFakeGetUserMedia = async (page: Page, opts: {track?: boolean} = {}) => {
  const {track = false} = opts;
  await page.evaluate((track) => {
    const w = window as any;
    const makeSilentAudioTrack = () => {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      const dst = gain.connect(ctx.createMediaStreamDestination());
      return dst.stream.getAudioTracks()[0];
    };
    const makeVideoTrack = (constraints: any) => {
      const canvas = document.createElement('canvas');
      const {
        width: {max: widthMax = 160, ideal: widthIdeal} = {} as any,
        height: {max: heightMax = 120, ideal: heightIdeal} = {} as any,
      } = constraints || {};
      canvas.width = widthIdeal || widthMax;
      canvas.height = heightIdeal || heightMax;
      const ctx = canvas.getContext('2d')!;
      // Some animation is needed because in some browsers HTMLVideoElement.play() will hang
      // until the canvas is updated. Use a relatively high frame rate to speed up tests.
      window.setInterval(() => {
        ctx.fillStyle = `#${Math.floor(Math.random() * 2 ** 24).toString(16).padStart(6, '0')}`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }, 100);
      return (canvas as any).captureStream().getVideoTracks()[0];
    };
    const fakeGetUserMedia = async (constraints: any) => {
      const audio = constraints && constraints.audio;
      const video = constraints && constraints.video;
      if (!audio && !video) {
        throw new DOMException('either audio or video is required', 'TypeError');
      }
      const stream = new MediaStream([
        ...(audio ? [makeSilentAudioTrack()] : []),
        ...(video ? [makeVideoTrack(video)] : []),
      ]);
      if (track) {
        w.__webrtcLastStream = stream;
        w.__webrtcLastConstraints = constraints;
      }
      return stream;
    };
    w.__fakeGetUserMedia = fakeGetUserMedia;
    w.navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
    // ep_webrtc's postAceInit checks enumerateDevices() and skips
    // auto-activation when no audio/video device is visible (this is
    // what lets embed_value.spec.ts pass on CI runners without a
    // camera). Tests that rely on auto-activate must therefore expose
    // fake devices too — fake them here in the same helper so callers
    // get the full activation flow without extra wiring.
    w.navigator.mediaDevices.enumerateDevices = async () => [
      {kind: 'audioinput', deviceId: 'fake-audio', groupId: 'fake', label: 'fake mic'},
      {kind: 'videoinput', deviceId: 'fake-video', groupId: 'fake', label: 'fake cam'},
    ];
  }, track);
};

// Fakes navigator.mediaDevices.enumerateDevices to expose one
// audioinput + one videoinput device, without touching getUserMedia.
// Use this in tests that need ep_webrtc to auto-activate but still
// want to control getUserMedia separately (e.g. errors.spec patches
// getUserMedia to throw specific DOMExceptions).
export const installFakeMediaDevices = async (page: Page) => {
  await page.evaluate(() => {
    const w = window as any;
    w.navigator.mediaDevices.enumerateDevices = async () => [
      {kind: 'audioinput', deviceId: 'fake-audio', groupId: 'fake', label: 'fake mic'},
      {kind: 'videoinput', deviceId: 'fake-video', groupId: 'fake', label: 'fake cam'},
    ];
  });
};

// Sets the `prefs` cookie so the next pad load picks up the supplied
// padPrefs. Mirrors helper.aNewPad({padPrefs}) from the legacy harness.
export const setPadPrefsCookie = async (page: Page, padPrefs: Record<string, any>) => {
  await page.context().addCookies([{
    name: 'prefsHttp',
    // Newer Etherpad stores the prefs cookie as `prefsHttp` and the
    // value is the prefs object itself (no `{prefs: ...}` wrapper).
    value: encodeURIComponent(JSON.stringify(padPrefs)),
    url: 'http://localhost:9001',
  }]);
};

// Reads a single key out of the live prefsHttp cookie. Replaces the
// legacy `padcookie.getPref(key)` calls that depended on Etherpad's
// CommonJS `require` being exposed on window — modern Etherpad bundles
// via esbuild and no longer exposes require to page scripts.
export const readPrefCookie = (page: Page, key: string) => page.evaluate((key) => {
  const cookies: Record<string, string> = {};
  for (const c of document.cookie.split('; ')) {
    if (!c) continue;
    const eq = c.indexOf('=');
    if (eq < 0) continue;
    cookies[c.slice(0, eq)] = c.slice(eq + 1);
  }
  const raw = cookies.prefsHttp;
  if (!raw) return null;
  try {
    const prefs = JSON.parse(decodeURIComponent(raw));
    return prefs[key] != null ? prefs[key] : null;
  } catch {
    return null;
  }
}, key);

// Navigates to a fresh pad with optional URL query params (mirrors
// helper.aNewPad({params}) from the legacy harness). Does not clear
// cookies – call setPadPrefsCookie first if you need padPrefs.
export const goToNewPadWithParams = async (
    page: Page, params: Record<string, any> = {}) => {
  const {randomUUID} = await import('node:crypto');
  const padId = 'FRONTEND_TESTS' + randomUUID();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const url = `http://localhost:9001/p/${padId}` +
              (qs.toString() ? `?${qs.toString()}` : '');
  await page.goto(url);
  await page.waitForSelector('iframe[name="ace_outer"]');
  await page.waitForSelector('#editorcontainer.initialized');
  return padId;
};
