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
  var videoSizes = {large: "260px", small: "160px"}
  var isActive = false;
  var urlParamString;
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
      self.setUrlParamString(window.location.search)
      if (clientVars.webrtc.configError) {
        $.gritter.add({
          title: "Error",
          text: "Ep_webrtc: There is an error with the configuration of this plugin. Please inform the administrators of this site. They will see the details in their logs.",
          sticky: true,
          class_name: "error"
        })
        return
      }
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
      if (clientVars.webrtc.video.sizes.large) {
        videoSizes.large = `${clientVars.webrtc.video.sizes.large}px`
      }
      if (clientVars.webrtc.video.sizes.small) {
        videoSizes.small = `${clientVars.webrtc.video.sizes.small}px`
      }
      self.init(context.pad);
      callback();
    },
    // so we can call it from testing
    setUrlParamString(str) {
      urlParamString = str
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
          reason = html10n.get("pad.ep_webrtc.error.notSupported.sorry") +
                   "<br><br>" +
                   html10n.get("pad.ep_webrtc.error.notSupported.howTo") +
                   "<br><br><a href=\"http://www.webrtc.org/\" target=\"_new\">" +
                   html10n.get("pad.ep_webrtc.error.notSupported.findOutMore") +
                   "</a>";
          self.sendErrorStat("NotSupported");
          break;
        case "CustomSecureConnectionError":
          reason = html10n.get("pad.ep_webrtc.error.ssl");
          self.sendErrorStat("SecureConnection");
          break;
        case "NotAllowedError":
          // For certain (I suspect older) browsers, `NotAllowedError` indicates either an insecure connection or the user rejecting camera permissions.
          // The error for both cases appears to be identical, so our best guess at telling them apart is to guess whether we are in a secure context.
          // (webrtc is considered secure for https connections or on localhost)
          if (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") {
            reason = html10n.get("pad.ep_webrtc.error.permission");
            self.sendErrorStat("Permission");
          } else {
            reason = html10n.get("pad.ep_webrtc.error.ssl");
            self.sendErrorStat("SecureConnection");
          }
          break;
        case "NotFoundError":
          reason = html10n.get("pad.ep_webrtc.error.notFound");
          self.sendErrorStat("NotFound");
          break;
        case "NotReadableError":
          // `err.message` might give useful info to the user (not necessarily useful for other error messages)
          reason = html10n.get("pad.ep_webrtc.error.notReadable") + "<br><br>" + err.message;
          self.sendErrorStat("Hardware");
          break;
        case "AbortError":
          // `err.message` might give useful info to the user (not necessarily useful for other error messages)
          reason = html10n.get("pad.ep_webrtc.error.otherCantAccess") + "<br><br>" + err.message;
          self.sendErrorStat("Abort");
          break;
        default:
          // `err` as a string might give useful info to the user (not necessarily useful for other error messages)
          reason = html10n.get("pad.ep_webrtc.error.other") + "<br><br>" + err;
          self.sendErrorStat("Unknown");
      }
      $.gritter.add({
        title: "Error",
        text: reason,
        sticky: true,
        class_name: "error"
      });
      self.hide();
    },
    hide: function() {
      $("#rtcbox").hide();
    },
    activate: function() {
      $("#options-enablertc").prop("checked", true);
      if (isActive) return Promise.reject(); // maybe should Promise.resolve()? Doesn't make a difference yet.
      self.show();
      padcookie.setPref("rtcEnabled", true);
      isActive = true;
      return self.getUserMedia();
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
        if ((videoTrack && videoTrack.stop === undefined) || (audioTrack && audioTrack.stop === undefined)) {
          // deprecated in 2015, probably disabled by 2020
          // https://developers.google.com/web/updates/2015/07/mediastream-deprecations
          // Perhaps we can obviate this by updating adapter.js?
          localStream.stop();
        } else {
          if (videoTrack) {
            videoTrack.stop();
          }
          if (audioTrack) {
            audioTrack.stop();
          }
        }
        localStream = null;
      }
      isActive = false;
    },
    toggleMuted: function() {
      var audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled; // returning "Muted" state, which is !enabled
      }
      return true // if there's no audio track, it's muted
    },
    toggleVideo: function() {
      var videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return !videoTrack.enabled; // returning whether it's disabled, to match toggleMuted
      }
      return true // if there's no video track, return true to indicate not enabled (matching toggleMuted)
    },
    getUserFromId: function(userId) {
      if (!self._pad || !self._pad.collabClient) return null;
      var result = self._pad.collabClient
        .getConnectedUsers()
        .filter(function(user) {
          return user.userId == userId;
        });
      var user = result.length > 0 ? result[0] : null;
      // if (user && userId == self.getUserId()) user.name = "Me";
      // Commented by JM because it made every user name "Me"
      return user;
    },
    setStream: function(userId, stream) {
      var isLocal = userId == self.getUserId();
      var videoId = "video_" + userId.replace(/\./g, "_");
      var video = $("#" + videoId)[0];

      var user = self.getUserFromId(userId)

      if (!video && stream) {
        var videoContainer = $("<div class='video-container'>")
          .css({
            'width': videoSizes.small,
            'max-height': videoSizes.small
          })
          .appendTo($("#rtcbox"))

        videoContainer.append($('<div class="user-name">').text(user.name))

        video = $("<video playsinline>")
          .attr("id", videoId)
          .css({
            "border-color": user.colorId,
            'width': videoSizes.small,
            'max-height': videoSizes.small
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

      ///////
      // Mute button
      ///////

      var audioTrack = stream.getAudioTracks()[0];
      const audioHardDisabled = clientVars.webrtc.audio.disabled === "hard"
      var initiallyMuted = true; // if there's no audio track, it's muted
      if (audioTrack) {
        initiallyMuted = !audioTrack.enabled
      }

      var $mute = $("<span class='interface-btn audio-btn buttonicon'>")
        .attr("title",
          audioHardDisabled
            ? "Audio disallowed by admin"
            : (initiallyMuted ? "Unmute" : "Mute")
        )
        .toggleClass("muted", initiallyMuted || audioHardDisabled)
        .toggleClass("disallowed", audioHardDisabled);

      if (!audioHardDisabled) {
        $mute.on({
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
      }

      ///////
      // Disable Video button
      ///////

      var $disableVideo = null
      if (isLocal) {
        var videoTrack = stream.getVideoTracks()[0];
        const videoHardDisabled = clientVars.webrtc.video.disabled === "hard"
        var initiallyVideoEnabled = false; // if there's no video track, it's disabled
        if (videoTrack) {
          initiallyVideoEnabled = videoTrack.enabled
        }
        $disableVideo = $("<span class='interface-btn video-btn buttonicon'>")
          .attr("title",
            videoHardDisabled
              ? "Video disallowed by admin"
              : (initiallyVideoEnabled ? "Disable video" : "Enable video"
            )
          )
          .toggleClass("off", !initiallyVideoEnabled || videoHardDisabled)
          .toggleClass("disallowed", videoHardDisabled);
        if (!videoHardDisabled) {
          $disableVideo.on({
            click: function(event) {
              var videoEnabled = !self.toggleVideo();
              $disableVideo
                .attr(
                  "title",
                  videoEnabled ? "Disable video" : "Enable video"
                )
                .toggleClass("off", !videoEnabled);
            }
          })
        }
      }

      ///////
      // Enlarge Video button
      ///////

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

            const videoSize = videoEnlarged ? videoSizes.large : videoSizes.small
            $video.parent().css({'width': videoSize, 'max-height': videoSize})
            $video.css({'width': videoSize, 'max-height': videoSize})
          }
        });


      ///////
      // Combining
      ///////

      $("#interface_" + videoId).remove();
      $("<div class='interface-container'>")
        .attr("id", "interface_" + videoId)
        .append($mute)
        .append($disableVideo)
        .append($largeVideo)
        .insertAfter($video);
    },
    // Sends a stat to the back end. `statName` must be in the
    // approved list on the server side.
    sendErrorStat: function(statName) {
      var msg = { "component" : "pad",
                  "type": "STATS",
                  "data": {statName: statName, type: 'RTC_MESSAGE'}
      }
      pad.socket.json.send(msg);
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
        audio: clientVars.webrtc.audio.disabled !== "hard",
        video: clientVars.webrtc.video.disabled !== "hard" && {
          optional: [],
          mandatory: {
            maxWidth: 320,
            maxHeight: 240
          }
        }
      };
      if (padcookie.getPref("fakeWebrtcFirefox")) {
        // The equivalent is done for chromium with cli option:
        // --use-fake-device-for-media-stream
        mediaConstraints.fake = true
      }
      return window.navigator.mediaDevices
        .getUserMedia(mediaConstraints)
        .then(function(stream) {
          // Disable audio and/or video according to user/site settings.
          // Do this before setting `localStream` to avoid a race condition
          // that might flash the video on for an instant before disabling it.
          var audioTrack = stream.getAudioTracks()[0];
          // using `.prop("checked") === true` to make absolutely sure the result is a boolean
          // we don't want bugs when it comes to muting/turning off video
          if (audioTrack) {
            audioTrack.enabled = $("#options-audioenabledonstart").prop("checked") === true;
          }
          var videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = $("#options-videoenabledonstart").prop("checked") === true;
          }

          localStream = stream;
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
      if (urlParamString.indexOf("av=YES") > -1) {
        return true;
      } else {
        return false;
      }
    },

    // Connect a setting to a checkbox. To be called on initialization.
    //
    // It will check for the value in urlVar, cookie, and the site-wide
    //   default value, in that order
    // If urlVar is found, it will also set the cookie
    // Finally, it sets up to set cookie if the user changes the setting in the gearbox
    settingToCheckbox: function(params) {
      if (params.urlVar === undefined) {throw Error("missing urlVar in settingToCheckbox");}
      if (params.cookie === undefined) {throw Error("missing cookie in settingToCheckbox");}
      if (params.defaultVal === undefined) {throw Error("missing defaultVal in settingToCheckbox");}
      if (params.checkboxId === undefined) {throw Error("missing checkboxId in settingToCheckbox");}

      var value

      // * If the setting is in the URL: use it, and also set the cookie
      // * If the setting is not in the URL: try to get it from the cookie
      // * If the setting was in neither, go with the site-wide default value
      //   but don't put it in the cookies
      if (urlParamString.indexOf(params.urlVar + "=true") > -1) {
        padcookie.setPref(params.cookie, true);
        value = true
      } else if (urlParamString.indexOf(params.urlVar + "=false") > -1) {
        padcookie.setPref(params.cookie, false);
        value = false
      } else {
        value = padcookie.getPref(params.cookie);
        if (typeof value === "undefined") {
          value = params.defaultVal;
        }
      }

      $(params.checkboxId).prop("checked", value);

      // If the user changes the checkbox, set the cookie accordingly
      $(params.checkboxId).on("change", function() {
        padcookie.setPref(params.cookie, this.checked);
      });
    },
    setupCheckboxes: function(pad) {
      // The checkbox shouldn't even exist if audio is not allowed
      if (clientVars.webrtc.audio.disabled !== "hard") {
        self.settingToCheckbox({
          urlVar: "webrtcaudioenabled",
          cookie: "audioEnabledOnStart",
          defaultVal: clientVars.webrtc.audio.disabled === "none",
          checkboxId: "#options-audioenabledonstart"
        })
      }

      // The checkbox shouldn't even exist if video is not allowed
      if (clientVars.webrtc.video.disabled !== "hard") {
        self.settingToCheckbox({
          urlVar: "webrtcvideoenabled",
          cookie: "videoEnabledOnStart",
          defaultVal: clientVars.webrtc.video.disabled === "none",
          checkboxId: "#options-videoenabledonstart"
        })
      }
    },
    init: function(pad) {
      self._pad = pad || window.pad;

      self.setupCheckboxes()

      // TODO - add this to setupCheckboxes. it's a bit involved.
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
window.ep_webrtc = rtc // Access to do some unit tests. If there's a more formal way to do this for all plugins, we can change to that.
