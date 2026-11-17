import {expect, test} from '@playwright/test';
import {goToNewPadWithParams} from '../helper/utils';

const testCases: Array<[string, string]> = [
  // Hard to test the version of NotAllowedError that is the SSL error
  // because it requires changing window.location
  ['NotAllowedError', 'Failed to get permission to access'],
  ['NotFoundError', 'Failed to access'],
  ['NotReadableError', 'hardware error occurred'],
  ['AbortError', 'not a hardware error'],
];

test.describe('error handling', () => {
  test.describe.configure({mode: 'serial'});
  let sharedPage: import('@playwright/test').Page;
  let videoBtnSelector: string;

  test.beforeAll(async ({browser}) => {
    sharedPage = await browser.newPage();
    test.setTimeout(60_000);
    // ep_webrtc's postAceInit checks enumerateDevices() and skips auto-
    // activation when no audio/video device is visible. This test
    // exercises the error-toast flow which needs the .video-btn button
    // (created by activate → addInterface) to exist, so install a fake
    // mediaDevices BEFORE the pad loads so auto-activation runs.
    // Each test below patches getUserMedia separately to throw the
    // specific DOMException it wants to verify.
    await sharedPage.addInitScript(() => {
      const w = window as any;
      w.navigator.mediaDevices.enumerateDevices = async () => [
        {kind: 'audioinput', deviceId: 'fake-audio', groupId: 'fake', label: 'fake mic'},
        {kind: 'videoinput', deviceId: 'fake-video', groupId: 'fake', label: 'fake cam'},
      ];
      w.navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
    await goToNewPadWithParams(sharedPage, {
      av: true,
      webrtcaudioenabled: false,
      webrtcvideoenabled: false,
    });
    await sharedPage.waitForFunction(
        () => (window as any).$('#rtcbox').data('initialized'));
    const ownInterfaceId: string = await sharedPage.evaluate(() => {
      const w = window as any;
      const ownUserId = w.ep_webrtc.getUserId();
      const ownVideoId = `video_${ownUserId.replace(/\./g, '_')}`;
      return `interface_${ownVideoId}`;
    });
    videoBtnSelector = `#${ownInterfaceId} .video-btn`;
    // Save the original getUserMedia for restore in afterAll.
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.__getUserMediaBackup = w.navigator.mediaDevices.getUserMedia;
    });
  });

  test.afterAll(async () => {
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.navigator.mediaDevices.getUserMedia = w.__getUserMediaBackup;
    });
    await sharedPage.close();
  });

  test.beforeEach(async () => {
    // No idea why but this needs to be called twice to actually make
    // #gritter-container hidden.
    await sharedPage.evaluate(() => {
      const w = window as any;
      // gritter is exposed via jQuery in modern Etherpad rather than as
      // a bare window.gritter global. Fall back to manual DOM cleanup
      // if neither is present so the beforeEach never throws. Remove
      // the entire #gritter-container so the next gritter.add cleanly
      // re-creates it via _verifyWrapper — leaving the container in
      // place leaks .gritter-title elements from earlier tests and
      // confuses the title-html assertion below.
      const gritter = w.gritter || (w.$ && w.$.gritter);
      if (gritter && typeof gritter.removeAll === 'function') {
        gritter.removeAll({fade: false});
        gritter.removeAll({fade: false});
      }
      document.querySelectorAll('#gritter-container').forEach((el) => el.remove());
    });
    const off = await sharedPage.locator(videoBtnSelector).evaluate(
        (el) => el.classList.contains('off'));
    expect(off).toBe(true);
  });

  for (const [errName, checkString] of testCases) {
    test(errName, async () => {
      await sharedPage.evaluate((errName) => {
        const w = window as any;
        w.navigator.mediaDevices.getUserMedia = async () => {
          const err: any = new Error();
          err.name = errName;
          throw err;
        };
      }, errName);
      await sharedPage.waitForFunction(() => {
        const w = window as any;
        return w.$('#gritter-container:visible').length === 0;
      }, undefined, {timeout: 1000});
      await sharedPage.locator(videoBtnSelector).evaluate((el) => {
        (window as any).$(el).click();
      });
      await sharedPage.waitForFunction(() => {
        const w = window as any;
        return w.$('#gritter-container:visible').length === 1;
      }, undefined, {timeout: 1000});
      const titleHtml = await sharedPage.evaluate(
          () => (window as any).$('.gritter-title').html());
      expect(titleHtml).toBe('Error');
      const contentHtml = await sharedPage.evaluate(
          () => (window as any).$('.gritter-content p').html());
      expect(contentHtml).toContain(checkString);
    });
  }

  test('gritter container does not intercept editor clicks', async () => {
    // Regression: a sticky "Failed to access camera/microphone" toast used
    // to span the top of the page and block all pointer events on the
    // editor underneath, which made the pad unusable in production and
    // broke every Playwright test that clicked into the editor.
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.navigator.mediaDevices.getUserMedia = async () => {
        const err: any = new Error();
        err.name = 'NotFoundError';
        throw err;
      };
    });
    await sharedPage.locator(videoBtnSelector).evaluate((el) => {
      (window as any).$(el).click();
    });
    await sharedPage.waitForFunction(() => {
      const w = window as any;
      return w.$('#gritter-container:visible').length === 1;
    }, undefined, {timeout: 1000});
    // Verify pointer-events is none on the container AND on the toast
    // subtree (.gritter-item, .gritter-content, the <p> with the error
    // text). The previous fix only set the container itself to none and
    // restored auto on .gritter-item — that left the actual toast
    // subtree intercepting pointer events, which is what made
    // Playwright report `<p>Failed to access...</p> from <#gritter-container>
    // subtree intercepts pointer events` in CI.
    const subtreePointerEvents = await sharedPage.evaluate(() => ({
      container: getComputedStyle(document.querySelector('#gritter-container')!).pointerEvents,
      item: getComputedStyle(document.querySelector('#gritter-container .gritter-item')!).pointerEvents,
      content: getComputedStyle(document.querySelector('#gritter-container .gritter-content')!).pointerEvents,
      close: getComputedStyle(document.querySelector('#gritter-container .gritter-close')!).pointerEvents,
    }));
    expect(subtreePointerEvents).toMatchObject({
      container: 'none',
      item: 'none',
      content: 'none',
      close: 'auto',
    });
    // Click the editor at the location overlaid by the gritter toast.
    // Without the fix Playwright's stability check sees the toast
    // subtree intercepting and times out at 90s.
    const innerFrame = sharedPage.frame('ace_inner');
    if (!innerFrame) throw new Error('ace_inner frame missing');
    await innerFrame.locator('#innerdocbody').first().click({timeout: 5000});
  });

  test('click-through is scoped to ep_webrtc toasts', async () => {
    // Regression: the click-through rule used to match every gritter on the
    // page, so core toasts (pad retention notice, privacy banner "Learn
    // more" link, ...) could not be hovered or clicked with ep_webrtc
    // installed, and clicks fell through to the editor underneath.
    await sharedPage.evaluate(() => {
      const w = window as any;
      w.$.gritter.add({
        title: 'Core notice',
        text: w.$('<p>').append(w.$('<a>').attr('href', '#').text('Learn more')),
        sticky: true,
        position: 'bottom',
        class_name: 'core-test-notice',
      });
    });
    const notice = sharedPage.locator('#gritter-container .gritter-item.core-test-notice');
    await expect(notice).toHaveCount(1);
    const pointerEvents = await notice.evaluate((el) => ({
      item: getComputedStyle(el).pointerEvents,
      content: getComputedStyle(el.querySelector('.gritter-content')!).pointerEvents,
      link: getComputedStyle(el.querySelector('a')!).pointerEvents,
    }));
    expect(pointerEvents).toMatchObject({item: 'auto', content: 'auto', link: 'auto'});
    await notice.hover({timeout: 5000});
    await notice.locator('.gritter-close').click({timeout: 5000});
    await expect(notice).toHaveCount(0);
  });
});
