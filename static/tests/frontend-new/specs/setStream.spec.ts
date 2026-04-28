import {expect, test} from '@playwright/test';
import {cartesian, goToNewPadWithParams, installFakeGetUserMedia} from '../helper/utils';

const otherUserId = 'other_user_id';
const otherVideoId = `video_${otherUserId.replace(/\./g, '_')}`;
const otherInterfaceId = `interface_${otherVideoId}`;

test.describe('setStream()', () => {
  test.describe('Audio and video enabled', () => {
    const testCases = [...cartesian(...Array(4).fill([false, true]) as boolean[][])].map(
        ([webrtcaudioenabled, webrtcvideoenabled, peerAudio, peerVideo]: boolean[]) => ({
          params: {webrtcaudioenabled, webrtcvideoenabled},
          peer: {audio: peerAudio, video: peerVideo},
        }));

    for (const tc of testCases) {
      test.describe(JSON.stringify(tc), () => {
        test.describe.configure({mode: 'serial'});
        let sharedPage: import('@playwright/test').Page;
        let ownVideoId: string;
        let ownInterfaceId: string;

        test.beforeAll(async ({browser}) => {
          sharedPage = await browser.newPage();
          test.setTimeout(60_000);
          await goToNewPadWithParams(sharedPage, {av: false, ...tc.params});
          await installFakeGetUserMedia(sharedPage);
          await sharedPage.evaluate(() => (window as any).ep_webrtc.activate());
          const ids = await sharedPage.evaluate(() => {
            const w = window as any;
            const ownUserId = w.ep_webrtc.getUserId();
            const ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
            return {ownVideoId, ownInterfaceId: `interface_${ownVideoId}`};
          });
          ownVideoId = ids.ownVideoId;
          ownInterfaceId = ids.ownInterfaceId;
          await sharedPage.evaluate(async ({peer, otherUserId}) => {
            const w = window as any;
            const peerStream = (peer.audio || peer.video)
                ? await w.__fakeGetUserMedia(peer)
                : new MediaStream();
            await w.ep_webrtc.setStream(otherUserId, peerStream);
          }, {peer: tc.peer, otherUserId});
        });

        test.afterAll(async () => {
          await sharedPage.close();
        });

        test('self and peer elements exist', async () => {
          const count = await sharedPage.locator('.interface-container').count();
          expect(count).toBe(2);
        });

        test('self interface', async () => {
          // Self view is always muted (no audio feedback).
          const muted = await sharedPage.locator(`#${ownVideoId}`)
              .evaluate((el) => (el as HTMLVideoElement).muted);
          expect(muted).toBe(true);

          const audioBtn = sharedPage.locator(`#${ownInterfaceId} .audio-btn`);
          expect(await audioBtn.count()).toBe(1);
          expect(await audioBtn.evaluate((el) => el.classList.contains('muted')))
              .toBe(!tc.params.webrtcaudioenabled);
          expect(await audioBtn.evaluate((el) => el.classList.contains('disallowed')))
              .toBe(false);

          const videoBtn = sharedPage.locator(`#${ownInterfaceId} .video-btn`);
          expect(await videoBtn.count()).toBe(1);
          expect(await videoBtn.evaluate((el) => el.classList.contains('off')))
              .toBe(!tc.params.webrtcvideoenabled);
          expect(await videoBtn.evaluate((el) => el.classList.contains('disallowed')))
              .toBe(false);

          const enlargeBtn = sharedPage.locator(`#${ownInterfaceId} .enlarge-btn`);
          expect(await enlargeBtn.count()).toBe(1);
          expect(await enlargeBtn.evaluate((el) => el.classList.contains('large')))
              .toBe(false);
        });

        test('peer interface', async () => {
          const audioBtn = sharedPage.locator(`#${otherInterfaceId} .audio-btn`);
          expect(await audioBtn.count()).toBe(1);
          // Only initially muted if browser doesn't permit autoplay unless muted.
          const peerVideoMuted = await sharedPage.locator(`#${otherVideoId}`)
              .evaluate((el) => (el as HTMLVideoElement).muted);
          expect(await audioBtn.evaluate((el) => el.classList.contains('muted')))
              .toBe(peerVideoMuted);

          const videoBtn = sharedPage.locator(`#${otherInterfaceId} .video-btn`);
          expect(await videoBtn.count()).toBe(0);

          const enlargeBtn = sharedPage.locator(`#${otherInterfaceId} .enlarge-btn`);
          expect(await enlargeBtn.count()).toBe(1);
          expect(await enlargeBtn.evaluate((el) => el.classList.contains('large')))
              .toBe(false);
        });
      });
    }
  });

  test.describe('Audio and video hard disabled', () => {
    test.describe.configure({mode: 'serial'});
    let sharedPage: import('@playwright/test').Page;
    let ownVideoId: string;
    let ownInterfaceId: string;

    test.beforeAll(async ({browser}) => {
      sharedPage = await browser.newPage();
      test.setTimeout(60_000);
      await goToNewPadWithParams(sharedPage, {
        av: false,
        webrtcaudioenabled: true,
        webrtcvideoenabled: true,
      });
      await installFakeGetUserMedia(sharedPage);
      await sharedPage.waitForFunction(
          () => (window as any).$('#rtcbox').data('initialized'));
      await sharedPage.evaluate(() => {
        const w = window as any;
        w.ep_webrtc._settings.audio.disabled = 'hard';
        w.ep_webrtc._settings.video.disabled = 'hard';
      });
      await sharedPage.evaluate(() => (window as any).ep_webrtc.activate());
      const ids = await sharedPage.evaluate(() => {
        const w = window as any;
        const ownUserId = w.ep_webrtc.getUserId();
        const ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
        return {ownVideoId, ownInterfaceId: `interface_${ownVideoId}`};
      });
      ownVideoId = ids.ownVideoId;
      ownInterfaceId = ids.ownInterfaceId;
      await sharedPage.evaluate(async (otherUserId) => {
        const w = window as any;
        await w.ep_webrtc.setStream(otherUserId, new MediaStream());
      }, otherUserId);
    });

    test.afterAll(async () => {
      await sharedPage.close();
    });

    test('self and peer elements exist', async () => {
      const count = await sharedPage.locator('.interface-container').count();
      expect(count).toBe(2);
    });

    test('self interface', async () => {
      const muted = await sharedPage.locator(`#${ownVideoId}`)
          .evaluate((el) => (el as HTMLVideoElement).muted);
      expect(muted).toBe(true);

      const audioBtn = sharedPage.locator(`#${ownInterfaceId} .audio-btn`);
      expect(await audioBtn.count()).toBe(1);
      expect(await audioBtn.evaluate((el) => el.classList.contains('muted'))).toBe(true);
      expect(await audioBtn.evaluate((el) => el.classList.contains('disallowed'))).toBe(true);

      const videoBtn = sharedPage.locator(`#${ownInterfaceId} .video-btn`);
      expect(await videoBtn.count()).toBe(1);
      expect(await videoBtn.evaluate((el) => el.classList.contains('off'))).toBe(true);
      expect(await videoBtn.evaluate((el) => el.classList.contains('disallowed'))).toBe(true);

      const enlargeBtn = sharedPage.locator(`#${ownInterfaceId} .enlarge-btn`);
      expect(await enlargeBtn.count()).toBe(1);
      expect(await enlargeBtn.evaluate((el) => el.classList.contains('large'))).toBe(false);
    });

    test('peer interface', async () => {
      const audioBtn = sharedPage.locator(`#${otherInterfaceId} .audio-btn`);
      expect(await audioBtn.count()).toBe(1);
      // Mute state only depends on browser autoplay-when-unmuted permission.
      const peerVideoMuted = await sharedPage.locator(`#${otherVideoId}`)
          .evaluate((el) => (el as HTMLVideoElement).muted);
      expect(await audioBtn.evaluate((el) => el.classList.contains('muted')))
          .toBe(peerVideoMuted);

      const videoBtn = sharedPage.locator(`#${otherInterfaceId} .video-btn`);
      expect(await videoBtn.count()).toBe(0);

      const enlargeBtn = sharedPage.locator(`#${otherInterfaceId} .enlarge-btn`);
      expect(await enlargeBtn.count()).toBe(1);
      expect(await enlargeBtn.evaluate((el) => el.classList.contains('large'))).toBe(false);
    });
  });
});
