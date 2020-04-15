(function() {
  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  if (!navigator.mediaDevices.getUserMedia) {
    var getUserMedia =
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia ||
      navigator.getUserMedia;

    if (getUserMedia) {
      navigator.mediaDevices.getUserMedia = function(constraints) {
        return new Promise(function(resolve, reject) {
          getUserMedia(
            constraints,
            function(stream) {
              resolve(stream);
            },
            function(error) {
              reject(error);
            }
          );
        });
      };
    } else {
      navigator.mediaDevices.getUserMedia = function() {
        // A missing `getUserMedia` seemingly can mean one of two things:
        //
        // 1) WebRTC is unsupported or disabled on this browser
        // 2) This is an insecure connection
        //   * This handling of insecure connections happens only on certain browsers.
        //     It was observed in Chromium 80 and Firefox 75, but not Firefox 68. I suspect it's the new behavior.
        //   * In other browsers, it handles insecure connections by throwing `NotAllowedError`.
        //     We still handle this case in the calling function.
        //   * See: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
        //     As of this writing, this claims that the browser does *both* of these things for
        //     insecure connections, which is of course impossible and thus confusing.
        //
        // We will attempt to distinguish these two cases by checking for various webrtc-related fields on
        // `window` (inspired by github.com/muaz-khan/DetectRTC). If none of those fields exist, we assume
        // that WebRTC is not supported on this browser.
        return new Promise(function(resolve, reject) {
          if (!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection || window.RTCIceGatherer)) {
            var e = new Error("getUserMedia is not supported in this browser.");
            // I'd use NotSupportedError but I'm afraid they'll change the spec on us again
            e.name = 'CustomNotSupportedError';
            reject(e);
          } else {
            var e = new Error("insecure connection");
            // I'd use NotAllowedError but I'm afraid they'll change the spec on us again
            e.name = 'CustomSecureConnectionError';
            reject(e);
          }
        });
      };
    }
  }
})();
