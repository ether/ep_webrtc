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
        return new Promise(function(resolve, reject) {
          reject("getUserMedia is not supported in this browser.");
        });
      };
    }
  }
})();
