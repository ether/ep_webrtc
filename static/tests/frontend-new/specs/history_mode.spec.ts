import {expect, test} from '@playwright/test';
import {goToNewPadWithParams, installFakeGetUserMedia} from '../helper/utils';

// Etherpad 3.2.x enters the timeslider "in-place" on the pad URL (pad_mode.ts):
// it never reloads the page or drops the pad socket, so an active ep_webrtc
// call keeps running. The catch is purely visual — core mounts the read-only
// history view in an absolutely-positioned iframe (#history-frame-mount,
// inset:0, z-index:4) that overlays #editorcontainerbox, where ep_webrtc's
// #rtcbox lives. Without our `body.history-mode #rtcbox { z-index: 5 }` rule
// the video column paints underneath that overlay and the call appears to
// vanish the moment you scrub history. These tests prove the call stays
// visible (and stacked above the overlay) in history mode and survives
// exiting back to live editing.
test.describe('ep_webrtc in history mode (timeslider)', () => {
  // serial: the tests share one page and walk it through live -> history -> live.
  test.describe.configure({mode: 'serial'});

  let page: import('@playwright/test').Page;

  test.beforeAll(async ({browser}) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await goToNewPadWithParams(page, {});
    await installFakeGetUserMedia(page);
    // Start the call explicitly (blocks until activation completes), then wait
    // for the self-view <video> so we know the call is genuinely up.
    await page.evaluate(() => (window as any).ep_webrtc.activate());
    await page.waitForFunction(() => (window as any).$('#rtcbox').data('initialized'),
        undefined, {timeout: 5000});
    await page.waitForFunction(() => document.querySelectorAll('#rtcbox video').length >= 1,
        undefined, {timeout: 5000});
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('entering history mode keeps the call visible and above the overlay', async () => {
    // pad_mode.ts enters history in-place when a revision hash appears
    // (hashchange listener). Use the canonical '#rev/N' form so enterHistory
    // doesn't pushState a second entry — keeps the exit test's button the
    // single deterministic way back to live mode.
    await page.evaluate(() => { window.location.hash = '#rev/0'; });
    await page.waitForSelector('body.history-mode', {timeout: 10_000});
    await page.waitForSelector('#history-frame-mount iframe', {timeout: 10_000});

    // The page never reloaded, so the call is still up: the self-view <video>
    // is still in the DOM.
    expect(await page.locator('#rtcbox video').count()).toBeGreaterThanOrEqual(1);

    // Our rule applied: #rtcbox is lifted above the z-index:4 history overlay.
    expect(await page.evaluate(
        () => getComputedStyle(document.querySelector('#rtcbox')!).zIndex)).toBe('5');

    // And it actually wins the stack: hit-testing the centre of the video tile
    // lands inside #rtcbox, not the overlay iframe (#history-frame-mount).
    const rtcboxIsOnTop = await page.evaluate(() => {
      const tile = document.querySelector('#rtcbox .video-container') ||
          document.querySelector('#rtcbox')!;
      const r = tile.getBoundingClientRect();
      const el = document.elementFromPoint(
          Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.id === 'rtcbox') return true;
        if (n.id === 'history-frame-mount') return false;
      }
      return false;
    });
    expect(rtcboxIsOnTop).toBe(true);
  });

  test('exiting history mode leaves the call running', async () => {
    // The history banner's "return to pad" button calls pad_mode's exitHistory().
    await page.click('#history-banner-return');
    await page.waitForFunction(() => !document.body.classList.contains('history-mode'),
        undefined, {timeout: 10_000});
    expect(await page.locator('#rtcbox video').count()).toBeGreaterThanOrEqual(1);
  });
});
