import {expect, test} from '@playwright/test';
import {goToNewPadWithParams, installFakeGetUserMedia, setPadPrefsCookie} from '../helper/utils';

test.describe('screen share button', () => {
  test.beforeEach(async ({page, context}) => {
    test.setTimeout(60_000);
    await context.clearCookies();
    await setPadPrefsCookie(page, {
      rtcEnabled: false,
      audioEnabledOnStart: false,
      videoEnabledOnStart: true,
    });
    await goToNewPadWithParams(page, {});
    await installFakeGetUserMedia(page);
    // Stub getDisplayMedia onto navigator.mediaDevices so the
    // screenshare-btn doesn't get hidden by addInterface (it checks
    // typeof navigator.mediaDevices.getDisplayMedia === 'function').
    // Tests below override this stub per-case to control behavior.
    await page.evaluate(() => {
      const w = window as any;
      w.__getDisplayMediaCallCount = 0;
      w.navigator.mediaDevices.getDisplayMedia = async () => {
        w.__getDisplayMediaCallCount++;
        const err: any = new Error('user cancelled the picker');
        err.name = 'NotAllowedError';
        throw err;
      };
    });
    await page.evaluate(() => (window as any).ep_webrtc.activate());
    await page.waitForFunction(
        () => (window as any).$('#rtcbox').data('initialized'));
    // Confirm the starting state: camera on, screenshare off.
    await page.waitForFunction(() => {
      const w = window as any;
      const videoBtn = w.$('.video-btn');
      const ssBtn = w.$('.screenshare-btn');
      return videoBtn.length === 1 && !videoBtn.hasClass('off') &&
             ssBtn.length === 1 && ssBtn.hasClass('off');
    }, undefined, {timeout: 5000});
  });

  test('canceling the screen-picker restores the camera', async ({page}) => {
    // Click the screenshare button. Our stubbed getDisplayMedia
    // rejects with NotAllowedError (the same error Chrome dispatches
    // when the user clicks Cancel in the picker).
    await page.evaluate(() => (window as any).$('.screenshare-btn').click());
    await page.evaluate(
        () => (window as any).$('.screenshare-btn').data('idle')('click'));
    // The picker really fired.
    const callCount = await page.evaluate(
        () => (window as any).__getDisplayMediaCallCount);
    expect(callCount).toBeGreaterThanOrEqual(1);
    // Final state: camera is back on, screenshare is off.
    const finalState = await page.evaluate(() => {
      const w = window as any;
      const videoBtn = w.$('.video-btn');
      const ssBtn = w.$('.screenshare-btn');
      return {
        videoOff: videoBtn.hasClass('off'),
        screenshareOff: ssBtn.hasClass('off'),
      };
    });
    expect(finalState).toEqual({videoOff: false, screenshareOff: true});
    // And there's a live, enabled video track in the local stream so
    // the user actually sees their camera again (not just a button
    // toggled on with no underlying media).
    const trackState = await page.evaluate(() => {
      const w = window as any;
      const v = document.querySelector('video') as HTMLVideoElement | null;
      const stream = v && (v.srcObject as MediaStream | null);
      const t = stream && stream.getVideoTracks()[0];
      return t == null ? null : {enabled: t.enabled, readyState: t.readyState};
    });
    expect(trackState).toEqual({enabled: true, readyState: 'live'});
  });

  test('canceling screen-picker when camera was off leaves both off', async ({page}) => {
    // Turn camera off first.
    await page.evaluate(() => (window as any).$('.video-btn').click());
    await page.evaluate(
        () => (window as any).$('.video-btn').data('idle')('click'));
    // Sanity-check both buttons off, no live enabled video track.
    const before = await page.evaluate(() => {
      const w = window as any;
      return {
        videoOff: w.$('.video-btn').hasClass('off'),
        screenshareOff: w.$('.screenshare-btn').hasClass('off'),
      };
    });
    expect(before).toEqual({videoOff: true, screenshareOff: true});
    // Click screenshare → cancel.
    await page.evaluate(() => (window as any).$('.screenshare-btn').click());
    await page.evaluate(
        () => (window as any).$('.screenshare-btn').data('idle')('click'));
    // Both should remain off (don't auto-enable the camera the user
    // had explicitly turned off).
    const after = await page.evaluate(() => {
      const w = window as any;
      return {
        videoOff: w.$('.video-btn').hasClass('off'),
        screenshareOff: w.$('.screenshare-btn').hasClass('off'),
      };
    });
    expect(after).toEqual({videoOff: true, screenshareOff: true});
  });
});
