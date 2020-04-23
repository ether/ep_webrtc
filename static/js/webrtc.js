/**
 * Copyright 2013 j <j@mailb.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

require("./adapter");
require("./getUserMediaPolyfill");
var padcookie = require("ep_etherpad-lite/static/js/pad_cookie").padcookie;
var hooks = require("ep_etherpad-lite/static/js/pluginfw/hooks");

var rtc = (function() {
  var isActive = false;
  var pc_config = {};
  var pc_constraints = {
    optional: [
      {
        DtlsSrtpKeyAgreement: true
      }
    ]
  };
  var sdpConstraints = {
    mandatory: {
      OfferToReceiveAudio: true,
      OfferToReceiveVideo: true
    }
  };
  var localStream,
    remoteStream = {},
    pc = {},
    callQueue = [];
  var enlargedVideos = new Set();

  var self = {
    //API HOOKS
    postAceInit: function(hook, context, callback) {
      if (!$('#editorcontainerbox').hasClass('flex-layout')) {
        $.gritter.add({
          title: "Error",
          text: "Ep_webrtc: Please upgrade to etherpad 1.8.3 for this plugin to work correctly",
          sticky: true,
          class_name: "error"
        })
      }
      pc_config.iceServers =
        clientVars.webrtc && clientVars.webrtc.iceServers
          ? clientVars.webrtc.iceServers
          : [
              {
                url: "stun:stun.l.google.com:19302"
              }
            ];
      self.init(context.pad);
      callback();
    },
    aceSetAuthorStyle: function(hook, context, callback) {
      if (context.author) {
        var user = self.getUserFromId(context.author)
        if (user) {
          $("#video_" + context.author.replace(/\./g, "_")).css({
            "border-color": user.colorId
          }).siblings('.user-name').text(user.name)
        }
      }
      callback();
    },
    userJoinOrUpdate: function(hook, context, callback) {
      /*
      var userId = context.userInfo.userId;
      console.log('userJoinOrUpdate', context, context.userInfo.userId, pc[userId]);
      */
      callback();
    },
    userLeave: function(hook, context, callback) {
      var userId = context.userInfo.userId;
      //console.log('user left, hang up', userId, context, pc[userId]);
      if (userId && pc[userId]) {
        self.hangup(userId, false);
      }
      callback();
    },
    handleClientMessage_RTC_MESSAGE: function(hook, context, callback) {
      if (isActive) {
        self.receiveMessage(context.payload);
      }
      callback([null]);
    },
    //END OF API HOOKS
    show: function() {
      $("#rtcbox").css('display', 'flex');
    },
    showUserMediaError: function(err) { // show an error returned from getUserMedia
      var reason
      // For reference on standard errors returned by getUserMedia:
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
      // However keep in mind that we add our own errors in getUserMediaPolyfill
      switch(err.name) {
        case "CustomNotSupportedError":
          reason = "Sorry, your browser does not support WebRTC. (or you have it disabled in your settings).<br><br>" +
              "To participate in this audio/video chat you have to user a browser with WebRTC support like Chrome, Firefox or Opera." +
              '<a href="http://www.webrtc.org/" target="_new">Find out more</a>'
          break;
        case "CustomSecureConnectionError":
          reason = "Sorry, you need to install SSL certificates for your Etherpad instance to use WebRTC"
          break;
        case "NotAllowedError":
          // For certain (I suspect older) browsers, `NotAllowedError` indicates either an insecure connection or the user rejecting camera permissions.
          // The error for both cases appears to be identical, so our best guess at telling them apart is to guess whether we are in a secure context.
          // (webrtc is considered secure for https connections or on localhost)
          if (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") {
            reason = "Sorry, you need to give us permission to use your camera and microphone"
          } else {
            reason = "Sorry, you need to install SSL certificates for your Etherpad instance to use WebRTC"
          }
          break;
        case "NotFoundError":
          reason = "Sorry, we couldnt't find a suitable camera on your device. If you have a camera, make sure it set up correctly and refresh this website to retry."
          break;
        case "NotReadableError":
          // `err.message` might give useful info to the user (not necessarily useful for other error messages)
          reason = "Sorry, a hardware error occurred that prevented access to your camera and/or microphone:<br><br>" + err.message
          break;
        case "AbortError":
          // `err.message` might give useful info to the user (not necessarily useful for other error messages)
          reason = "Sorry, an error occurred (probably not hardware related) that prevented access to your camera and/or microphone:<br><br>" + err.message
          break;
        default:
          // `err` as a string might give useful info to the user (not necessarily useful for other error messages)
          reason = "Sorry, there was an unknown Error:<br><br>" + err
      }
      $.gritter.add({
        title: "Error",
        text: reason,
        sticky: true,
        class_name: "error"
      })
      self.hide();
    },
    hide: function() {
      $("#rtcbox").hide();
    },
    activate: function() {
      $("#options-enablertc").prop("checked", true);
      if (isActive) return;
      self.show();
      padcookie.setPref("rtcEnabled", true);
      self.getUserMedia();
      isActive = true;
    },
    deactivate: function() {
      $("#options-enablertc").prop("checked", false);
      if (!isActive) return;
      self.hide();
      padcookie.setPref("rtcEnabled", false);
      self.hangupAll();
      if (localStream) {
        var videoTrack = localStream.getVideoTracks()[0];
        var audioTrack = localStream.getAudioTracks()[0];
        self.setStream(self._pad.getUserId(), "");
        if (videoTrack.stop === undefined) {
          // deprecated in 2015, probably disabled by 2020
          // https://developers.google.com/web/updates/2015/07/mediastream-deprecations
          localStream.stop();
        } else {
          videoTrack.stop();
          audioTrack.stop();
        }
        localStream = null;
      }
      isActive = false;
    },
    toggleMuted: function() {
      var audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled;
      }
    },
    toggleVideo: function() {
      var videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return !videoTrack.enabled;
      }
    },
    getUserFromId: function(userId) {
      if (!self._pad || !self._pad.collabClient) return null;
      var result = self._pad.collabClient
        .getConnectedUsers()
        .filter(function(user) {
          return user.userId == userId;
        });
      var user = result.length > 0 ? result[0] : null;
      if (user && userId == self.getUserId()) user.name = "Me";
      return user;
    },
    setStream: function(userId, stream) {
      var isLocal = userId == self.getUserId();
      var videoId = "video_" + userId.replace(/\./g, "_");
      var video = $("#" + videoId)[0];

      var user = self.getUserFromId(userId)

      if (!video && stream) {
        var videoContainer = $("<div class='video-container'>").appendTo($("#rtcbox"))

        videoContainer.append($('<div class="user-name">').text(user.name))

        video = $("<video playsinline>")
          .attr("id", videoId)
          .css({
            "border-color": user.colorId
          })
          .on({
            loadedmetadata: function() {
              self.addInterface(userId, stream);
            }
          })
          .appendTo(videoContainer)[0];

        video.autoplay = true;
        if (isLocal) {
          videoContainer.addClass('local-user');
          video.muted = true;
        }
        self.addInterface(userId, stream);
      }
      if (stream) {
        attachMediaStream(video, stream);
      } else if (video) {
        $(video).parent().remove();
      }
    },
    addInterface: function(userId, stream) {
      var isLocal = userId == self.getUserId();
      var videoId = "video_" + userId.replace(/\./g, "_");
      var $video = $("#" + videoId);

      var audioTrack = stream.getAudioTracks()[0];
      var initiallyMuted = false;
      if (audioTrack) {
        initiallyMuted = !audioTrack.enabled
      }

      var $mute = $("<span class='interface-btn audio-btn buttonicon'>")
        .attr("title", initiallyMuted ? "Unmute" : "Mute")
        .toggleClass("muted", initiallyMuted)
        .on({
          click: function(event) {
            var muted;
            if (isLocal) {
              muted = self.toggleMuted();
            } else {
              $video[0].muted = !$video[0].muted;
              muted = $video[0].muted;
            }
            $mute
              .attr("title", muted ? "Unmute" : "Mute")
              .toggleClass("muted", muted);
          }
        });
      var videoEnabled = true;
      var $disableVideo = isLocal
        ? $("<span class='interface-btn video-btn buttonicon'>")
            .attr("title", "Disable video")
            .on({
              click: function(event) {
                self.toggleVideo();
                videoEnabled = !videoEnabled;
                $disableVideo
                  .attr(
                    "title",
                    videoEnabled ? "Disable video" : "Enable video"
                  )
                  .toggleClass("off", !videoEnabled);
              }
            })
        : null;

      var videoEnlarged = false;
      var $largeVideo = $("<span class='interface-btn enlarge-btn buttonicon'>")
        .attr("title", "Make video larger")
        .on({
          click: function(event) {
            videoEnlarged = !videoEnlarged;

            if (videoEnlarged) {
              enlargedVideos.add(userId);
            } else {
              enlargedVideos.delete(userId);
            }

            $largeVideo
              .attr(
                "title",
                videoEnlarged ? "Make video smaller" : "Make video larger"
              )
              .toggleClass("large", videoEnlarged);

            $video.parent().toggleClass('large', videoEnlarged)
          }
        });

      $("#interface_" + videoId).remove();
      $("<div class='interface-container'>")
        .attr("id", "interface_" + videoId)
        .append($mute)
        .append($disableVideo)
        .append($largeVideo)
        .insertAfter($video);
    },
    sendMessage: function(to, data) {
      self._pad.collabClient.sendMessage({
        type: "RTC_MESSAGE",
        payload: { data: data, to: to }
      });
    },
    receiveMessage: function(msg) {
      var peer = msg.from,
        data = msg.data,
        type = data.type;
      if (peer == self.getUserId()) {
        // console.log('ignore own messages');
        return;
      }
      /*
      if (type != 'icecandidate')
        console.log('receivedMessage', 'peer', peer, 'type', type, 'data', data);
      */
      if (type == "hangup") {
        self.hangup(peer, false);
      } else if (type == "offer") {
        if (pc[peer]) {
          console.log("existing connection?", pc[peer]);
          self.hangup(peer, false);
          self.createPeerConnection(peer);
        } else {
          self.createPeerConnection(peer);
        }
        if (localStream) {
          if (pc[peer].getLocalStreams) {
            if (!pc[peer].getLocalStreams().length) {
              pc[peer].addStream(localStream);
            }
          } else if (pc[peer].localStreams) {
            if (!pc[peer].localStreams.length) {
              pc[peer].addStream(localStream);
            }
          }
        }
        var offer = new RTCSessionDescription(data.offer);
        pc[peer].setRemoteDescription(
          offer,
          function() {
            pc[peer].createAnswer(
              function(desc) {
                desc.sdp = cleanupSdp(desc.sdp);
                pc[peer].setLocalDescription(
                  desc,
                  function() {
                    self.sendMessage(peer, { type: "answer", answer: desc });
                  },
                  logError
                );
              },
              logError,
              sdpConstraints
            );
          },
          logError
        );
      } else if (type == "answer") {
        if (pc[peer]) {
          var answer = new RTCSessionDescription(data.answer);
          pc[peer].setRemoteDescription(answer, function() {}, logError);
        }
      } else if (type == "icecandidate") {
        if (pc[peer]) {
          var candidate = new RTCIceCandidate(data.candidate);
          var p = pc[peer].addIceCandidate(candidate);
          if (p) {
            p.then(function() {
              // Do stuff when the candidate is successfully passed to the ICE agent
            }).catch(function() {
              console.log("Error: Failure during addIceCandidate()", data);
            });
          }
        }
      } else {
        console.log("unknown message", data);
      }
    },
    hangupAll: function() {
      Object.keys(pc).forEach(function(userId) {
        self.hangup(userId);
      });
    },
    getUserId: function() {
      return self._pad && self._pad.getUserId();
    },
    hangup: function(userId, notify) {
      notify = arguments.length == 1 ? true : notify;
      if (pc[userId] && userId != self.getUserId()) {
        self.setStream(userId, "");
        pc[userId].close();
        delete pc[userId];
        notify && self.sendMessage(userId, { type: "hangup" });
      }
    },
    call: function(userId) {
      if (!localStream) {
        callQueue.push(userId);
        return;
      }
      var constraints = { optional: [], mandatory: {} };
      // temporary measure to remove Moz* constraints in Chrome
      if (webrtcDetectedBrowser === "chrome") {
        for (var prop in constraints.mandatory) {
          if (prop.indexOf("Moz") != -1) {
            delete constraints.mandatory[prop];
          }
        }
      }
      constraints = mergeConstraints(constraints, sdpConstraints);

      if (!pc[userId]) {
        self.createPeerConnection(userId);
      }
      pc[userId].addStream(localStream);
      pc[userId].createOffer(
        function(desc) {
          desc.sdp = cleanupSdp(desc.sdp);
          pc[userId].setLocalDescription(
            desc,
            function() {
              self.sendMessage(userId, { type: "offer", offer: desc });
            },
            logError
          );
        },
        logError,
        constraints
      );
    },
    createPeerConnection: function(userId) {
      if (pc[userId]) {
        console.log(
          "WARNING creating PC connection even though one exists",
          userId
        );
      }
      pc[userId] = new RTCPeerConnection(pc_config, pc_constraints);
      pc[userId].onicecandidate = function(event) {
        if (event.candidate) {
          self.sendMessage(userId, {
            type: "icecandidate",
            candidate: event.candidate
          });
        }
      };
      pc[userId].onaddstream = function(event) {
        remoteStream[userId] = event.stream;
        self.setStream(userId, event.stream);
      };
      pc[userId].onremovestream = function(event) {
        self.setStream(userId, "");
      };
      /*
      pc[userId].onnsignalingstatechange = function(event) {
        console.log('onsignalingstatechange;', event);
      };
      pc[userId].oniceconnectionstatechange = function(event) {
        if (event.target.iceConnectionState == 'disconnected'
            || event.target.iceConnectionState == 'closed') {
          console.log('hangup due to iceConnectionState', event.target.iceConnectionState);
          self.hangup(userId, false);
        }
      };
      */
    },
    getUserMedia: function() {
      var mediaConstraints = {
        audio: true,
        video: {
          optional: [],
          mandatory: {
            maxWidth: 320,
            maxHeight: 240
          }
        }
      };
      window.navigator.mediaDevices
        .getUserMedia(mediaConstraints)
        .then(function(stream) {
          localStream = stream;
          var audioTrack = localStream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = !$("#options-audiodefaultmuted").prop("checked");
          }
          self.setStream(self._pad.getUserId(), stream);
          self._pad.collabClient.getConnectedUsers().forEach(function(user) {
            if (user.userId != self.getUserId()) {
              if (pc[user.userId]) {
                self.hangup(user.userId);
              }
              self.call(user.userId);
            }
          });
        })
        .catch(function(err) {self.showUserMediaError(err)})
    },
    avInURL: function() {
      if (window.location.search.indexOf("av=YES") > -1) {
        return true;
      } else {
        return false;
      }
    },
    initOptions: function() {
      var audioDefaultMuted = padcookie.getPref("audioDefaultMuted");
      if (typeof audioDefaultMuted !== "undefined") {
        $("#options-audiodefaultmuted").prop("checked", audioDefaultMuted);
      }
      $("#options-audiodefaultmuted").on("change", function() {
        padcookie.setPref("audioDefaultMuted", this.checked);
      });
    },
    init: function(pad) {
      self.initOptions()
      self._pad = pad || window.pad;
      var rtcEnabled = padcookie.getPref("rtcEnabled");
      if (typeof rtcEnabled == "undefined") {
        rtcEnabled = $("#options-enablertc").prop("checked");
      }

      // if a URL Parameter is set then activate
      if (self.avInURL()) self.activate();

      if (clientVars.webrtc.listenClass) {
        $(clientVars.webrtc.listenClass).on("click", function() {
          self.activate();
        });
      }

      if (rtcEnabled) {
        self.activate();
      } else {
        self.deactivate();
      }
      $("#options-enablertc").on("change", function() {
        if (this.checked) {
          self.activate();
        } else {
          self.deactivate();
        }
      });
      if (isActive) {
        $(window).on("unload", function() {
          self.hangupAll();
        });
      }
    }
  };

  // Normalize RTC implementation between browsers
  var getUserMedia = window.navigator.mediaDevices.getUserMedia;
  var attachMediaStream = function(element, stream) {
    if (typeof element.srcObject !== "undefined") {
      element.srcObject = stream;
    } else if (typeof element.mozSrcObject !== "undefined") {
      element.mozSrcObject = stream;
    } else if (typeof element.src !== "undefined") {
      element.src = URL.createObjectURL(stream);
    } else {
      console.log("Error attaching stream to element.", element);
    }
  };
  var webrtcDetectedBrowser = "chrome";

  // Set Opus as the default audio codec if it's present.
  function preferOpus(sdp) {
    var sdpLines = sdp.split("\r\n");

    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search("m=audio") !== -1) {
        var mLineIndex = i;
        break;
      }
    }
    if (mLineIndex === null) return sdp;

    // If Opus is available, set it as the default in m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search("opus/48000") !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        if (opusPayload)
          sdpLines[mLineIndex] = setDefaultCodec(
            sdpLines[mLineIndex],
            opusPayload
          );
        break;
      }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join("\r\n");
    return sdp;
  }

  // Set Opus in stereo if stereo is enabled.
  function addStereo(sdp) {
    var sdpLines = sdp.split("\r\n");

    // Find opus payload.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search("opus/48000") !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        break;
      }
    }

    // Find the payload in fmtp line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search("a=fmtp") !== -1) {
        var payload = extractSdp(sdpLines[i], /a=fmtp:(\d+)/);
        if (payload === opusPayload) {
          var fmtpLineIndex = i;
          break;
        }
      }
    }
    // No fmtp line found.
    if (fmtpLineIndex === null) return sdp;

    // append stereo=1 to fmtp line.
    sdpLines[fmtpLineIndex] = sdpLines[fmtpLineIndex].concat(" stereo=1");

    sdp = sdpLines.join("\r\n");
    return sdp;
  }

  function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return result && result.length == 2 ? result[1] : null;
  }

  // Set the selected codec to the first in m line.
  function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(" ");
    var newLine = new Array();
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
      if (index === 3)
        // Format of media starts from the fourth.
        newLine[index++] = payload; // Put target payload to the first.
      if (elements[i] !== payload) newLine[index++] = elements[i];
    }
    return newLine.join(" ");
  }

  // Strip CN from sdp before CN constraints is ready.
  function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(" ");
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length - 1; i >= 0; i--) {
      var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
      if (payload) {
        var cnPos = mLineElements.indexOf(payload);
        if (cnPos !== -1) {
          // Remove CN payload from m line.
          mLineElements.splice(cnPos, 1);
        }
        // Remove CN line in sdp
        sdpLines.splice(i, 1);
      }
    }

    sdpLines[mLineIndex] = mLineElements.join(" ");
    return sdpLines;
  }

  function sdpRate(sdp, rate) {
    rate = rate || 1638400;
    return sdp.replace(/b=AS:\d+\r/g, "b=AS:" + rate + "\r");
  }

  function cleanupSdp(sdp) {
    sdp = preferOpus(sdp);
    sdp = sdpRate(sdp);
    return sdp;
  }

  function mergeConstraints(cons1, cons2) {
    var merged = cons1;
    for (var name in cons2.mandatory) {
      merged.mandatory[name] = cons2.mandatory[name];
    }
    merged.optional.concat(cons2.optional);
    return merged;
  }
  function logError(error) {
    console.log("WebRTC ERROR:", error);
  }

  self.pc = pc;
  return self;
})();

exports.rtc = rtc;
