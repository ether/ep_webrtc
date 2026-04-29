import {expect, test} from '@playwright/test';
import {goToNewPadWithParams, installFakeGetUserMedia, setPadPrefsCookie} from '../helper/utils';

// Helpers for inspecting the in-page tracks captured by the fake
// getUserMedia (see installFakeGetUserMedia({track:true})).
const tracksInfo = async (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const w = window as any;
      const stream: MediaStream | undefined = w.__webrtcLastStream;
      const a = stream && stream.getAudioTracks()[0];
      const v = stream && stream.getVideoTracks()[0];
      return {
        hasStream: !!stream,
        audio: a ? {enabled: a.enabled} : null,
        video: v ? {enabled: v.enabled} : null,
      };
    });

test.describe('Test the behavior of the interface buttons: Mute, Video Disable, Enlarge', () => {
  test.describe('audio and video on by default', () => {
    test.beforeEach(async ({page, context}) => {
      test.setTimeout(60_000);
      await context.clearCookies();
      await setPadPrefsCookie(page, {
        rtcEnabled: false,
        audioEnabledOnStart: true,
        videoEnabledOnStart: true,
      });
      await goToNewPadWithParams(page, {});
      await installFakeGetUserMedia(page, {track: true});
      await page.evaluate(() => (window as any).ep_webrtc.activate());
    });

    test('enlarges then shrinks', async ({page}) => {
      test.setTimeout(60_000);
      // i.e., "160.25px" -> 160.25 the number
      const numFromCss = (s: string | null): number => {
        expect(s && s.endsWith('px')).toBeTruthy();
        return Number((s as string).slice(0, -2));
      };

      await page.waitForFunction(() => {
        const v = document.querySelector('video') as HTMLElement | null;
        if (!v) return false;
        const cs = getComputedStyle(v);
        const w = parseFloat(cs.width);
        const h = parseFloat(cs.height);
        return 159 < w && w < 161 && 119 < h && h < 121;
      });

      await page.locator('.enlarge-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      // Expect grow to 260, 190 (test originally used >259 width and >194 height).
      await page.waitForFunction(() => {
        const v = document.querySelector('video') as HTMLElement | null;
        if (!v) return false;
        const cs = getComputedStyle(v);
        return parseFloat(cs.width) > 259 && parseFloat(cs.height) > 194;
      }, undefined, {timeout: 1000});
      await page.locator('.enlarge-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      // Shrink back to <161, <121.
      await page.waitForFunction(() => {
        const v = document.querySelector('video') as HTMLElement | null;
        if (!v) return false;
        const cs = getComputedStyle(v);
        return parseFloat(cs.width) < 161 && parseFloat(cs.height) < 121;
      }, undefined, {timeout: 1000});
      // Silence numFromCss "unused" warning by referencing it in a noop.
      void numFromCss;
    });

    test('mutes then unmutes', async ({page}) => {
      test.setTimeout(60_000);
      const info0 = await tracksInfo(page);
      expect(info0.audio?.enabled).toBe(true);
      expect(await page.locator('.audio-btn.muted').count()).toBe(0);
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Mute');

      await page.locator('.audio-btn').first().evaluate(
          (el) => (window as any).$(el).click());

      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const a = stream && stream.getAudioTracks()[0];
        return document.querySelectorAll('.audio-btn.muted').length === 1 && a && a.enabled === false;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Unmute');

      await page.locator('.audio-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const a = stream && stream.getAudioTracks()[0];
        return document.querySelectorAll('.audio-btn.muted').length === 0 && a && a.enabled === true;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Mute');
    });

    test('disables then enables video', async ({page}) => {
      test.setTimeout(60_000);
      const info0 = await tracksInfo(page);
      expect(info0.video?.enabled).toBe(true);
      expect(await page.locator('.video-btn.off').count()).toBe(0);
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Disable');

      await page.locator('.video-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const v = stream && stream.getVideoTracks()[0];
        return document.querySelectorAll('.video-btn.off').length === 1 && v && v.enabled === false;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Enable');

      await page.locator('.video-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const v = stream && stream.getVideoTracks()[0];
        return document.querySelectorAll('.video-btn.off').length === 0 && v && v.enabled === true;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Disable');
    });
  });

  test.describe('audio and video off by default', () => {
    test.beforeEach(async ({page, context}) => {
      test.setTimeout(60_000);
      await context.clearCookies();
      await setPadPrefsCookie(page, {
        rtcEnabled: false,
        audioEnabledOnStart: false,
        videoEnabledOnStart: false,
      });
      await goToNewPadWithParams(page, {});
      await installFakeGetUserMedia(page, {track: true});
      await page.evaluate(() => (window as any).ep_webrtc.activate());
    });

    test('unmutes then mutes', async ({page}) => {
      test.setTimeout(60_000);
      const info0 = await tracksInfo(page);
      // No getUserMedia call yet because audio/video are off on start.
      expect(info0.hasStream).toBe(false);
      expect(await page.locator('.audio-btn.muted').count()).toBe(1);
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Unmute');

      await page.locator('.audio-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const a = stream && stream.getAudioTracks()[0];
        return document.querySelectorAll('.audio-btn.muted').length === 0 &&
               a != null && a.enabled;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Mute');

      await page.locator('.audio-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const a = stream && stream.getAudioTracks()[0];
        return document.querySelectorAll('.audio-btn.muted').length === 1 &&
               a && a.enabled === false;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.audio-btn').first().getAttribute('title')).toBe('Unmute');
    });

    test('enables then disables video', async ({page}) => {
      test.setTimeout(60_000);
      const info0 = await tracksInfo(page);
      expect(info0.hasStream).toBe(false);
      expect(await page.locator('.video-btn.off').count()).toBe(1);
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Enable');

      await page.locator('.video-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const v = stream && stream.getVideoTracks()[0];
        return document.querySelectorAll('.video-btn.off').length === 0 &&
               v != null && v.enabled;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Disable');

      await page.locator('.video-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForFunction(() => {
        const w = window as any;
        const stream: MediaStream | undefined = w.__webrtcLastStream;
        const v = stream && stream.getVideoTracks()[0];
        return document.querySelectorAll('.video-btn.off').length === 1 &&
               v && v.enabled === false;
      }, undefined, {timeout: 3000});
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toContain('Enable');
    });
  });

  test.describe('audio and video hard-disabled', () => {
    test.beforeEach(async ({page, context}) => {
      test.setTimeout(60_000);
      await context.clearCookies();
      // Disable WebRTC so we can install fake getUserMedia and tweak settings
      // before activation.
      await goToNewPadWithParams(page, {av: false});
      await page.waitForFunction(
          () => (window as any).$('#rtcbox').data('initialized'));
      await page.evaluate(() => {
        const w = window as any;
        w.ep_webrtc._settings.audio.disabled = 'hard';
        w.ep_webrtc._settings.video.disabled = 'hard';
      });
      await installFakeGetUserMedia(page, {track: true});
      await page.evaluate(() => (window as any).ep_webrtc.activate());
    });

    test('cannot mute or unmute', async ({page}) => {
      test.setTimeout(60_000);
      expect(await page.locator('.audio-btn.disallowed').count()).toBe(1);
      expect(await page.locator('.audio-btn.muted').count()).toBe(1);
      expect(await page.locator('.audio-btn').first().getAttribute('title'))
          .toBe('Audio disallowed by admin');
      const info = await tracksInfo(page);
      expect(info.hasStream).toBe(false);

      await page.locator('.audio-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForTimeout(200);
      expect(await page.locator('.audio-btn.disallowed').count()).toBe(1);
      expect(await page.locator('.audio-btn.muted').count()).toBe(1);
      expect(await page.locator('.audio-btn').first().getAttribute('title'))
          .toBe('Audio disallowed by admin');
      const info2 = await tracksInfo(page);
      expect(info2.hasStream).toBe(false);
    });

    test('cannot enable or disable video', async ({page}) => {
      test.setTimeout(60_000);
      expect(await page.locator('.video-btn.disallowed').count()).toBe(1);
      expect(await page.locator('.video-btn.off').count()).toBe(1);
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toBe('Video disallowed by admin');
      const info = await tracksInfo(page);
      expect(info.hasStream).toBe(false);

      await page.locator('.video-btn').first().evaluate(
          (el) => (window as any).$(el).click());
      await page.waitForTimeout(200);
      expect(await page.locator('.video-btn.disallowed').count()).toBe(1);
      expect(await page.locator('.video-btn.off').count()).toBe(1);
      expect(await page.locator('.video-btn').first().getAttribute('title'))
          .toBe('Video disallowed by admin');
      const info2 = await tracksInfo(page);
      expect(info2.hasStream).toBe(false);
    });
  });
});
