import {Browser, Page, expect, test} from '@playwright/test';
import {installFakeGetUserMedia} from '../helper/utils';

// Regression test: every trickled ICE candidate used to go out as its own pad message. A peer
// joining a video pad then sent a burst of messages that tripped Etherpad's commitRateLimiting and
// got the user disconnected. Candidates must now be sent in batches ({candidates: [...]}), and the
// peers must still connect using them.

const openPeer = async (browser: Browser, padId: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:9001/p/${padId}?av=false`);
  await page.waitForSelector('#editorcontainer.initialized');
  await installFakeGetUserMedia(page);
  // Record the shape of every outgoing WebRTC signalling message.
  await page.evaluate(() => {
    const w = window as any;
    w.__rtcSent = [];
    const cc = w.pad.collabClient;
    const orig = cc.sendMessage.bind(cc);
    cc.sendMessage = (msg: any) => {
      if (msg && msg.type === 'RTC_MESSAGE') w.__rtcSent.push(msg.payload.data);
      return orig(msg);
    };
  });
  await page.locator('#options-enablertc').evaluate((el) => (window as any).$(el).click());
  await page.waitForFunction(() => (window as any).$('#rtcbox').data('initialized'));
  return page;
};

const remoteVideoLive = (page: Page) => page.waitForFunction(() => {
  const w = window as any;
  const ownId = `video_${w.ep_webrtc.getUserId().replace(/\./g, '_')}`;
  return [...document.querySelectorAll('#rtcbox video')].some(
      (v: any) => v.id !== ownId && v.readyState >= 2 && v.srcObject != null);
}, null, {timeout: 30_000});

test('ICE candidates are batched and peers still connect', async ({browser}) => {
  test.setTimeout(90_000);
  const {randomUUID} = await import('node:crypto');
  const padId = `FRONTEND_TESTS${randomUUID()}`;
  const a = await openPeer(browser, padId);
  const b = await openPeer(browser, padId);
  await Promise.all([remoteVideoLive(a), remoteVideoLive(b)]);
  for (const page of [a, b]) {
    const sent: any[] = await page.evaluate(() => (window as any).__rtcSent);
    expect(sent.filter((d) => d.candidate !== undefined), 'single-candidate messages').toEqual([]);
    const batches = sent.filter((d) => Array.isArray(d.candidates));
    expect(batches.length).toBeGreaterThan(0);
    for (const {candidates} of batches) {
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(32);
    }
  }
  await a.context().close();
  await b.context().close();
});
