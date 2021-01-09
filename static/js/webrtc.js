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
'use strict';

require('./adapter');
require('./getUserMediaPolyfill');
const padcookie = require('ep_etherpad-lite/static/js/pad_cookie').padcookie;

const rtc = (() => {
  const videoSizes = {large: '260px', small: '160px'};
  let isActive = false;
  let urlParamString;
  const pc_config = {};
  const pc_constraints = {
    optional: [
      {
        DtlsSrtpKeyAgreement: true,
      },
    ],
  };
  const sdpConstraints = {
    mandatory: {
      OfferToReceiveAudio: true,
      OfferToReceiveVideo: true,
    },
  };
  let localStream;
  const remoteStream = {};
  const pc = {};
  const callQueue = [];
  const enlargedVideos = new Set();

  const self = {
    // API HOOKS
    postAceInit: (hook, context, callback) => {
      self.setUrlParamString(window.location.search);
      if (clientVars.webrtc.configError) {
        $.gritter.add({
          title: 'Error',
          text: `Ep_webrtc: There is an error with the configuration of this plugin.
          Please inform the administrators of this site. They will see the details in their logs.`,
          sticky: true,
          class_name: 'error',
        });
        return;
      }
      if (!$('#editorcontainerbox').hasClass('flex-layout')) {
        $.gritter.add({
          title: 'Error',
          text: 'Ep_webrtc: Please upgrade to etherpad 1.8.3 for this plugin to work correctly',
          sticky: true,
          class_name: 'error',
        });
      }
      pc_config.iceServers =
        clientVars.webrtc && clientVars.webrtc.iceServers
          ? clientVars.webrtc.iceServers
          : [
              {
                url: 'stun:stun.l.google.com:19302',
              },
            ];
      if (clientVars.webrtc.video.sizes.large) {
        videoSizes.large = `${clientVars.webrtc.video.sizes.large}px`;
      }
      if (clientVars.webrtc.video.sizes.small) {
        videoSizes.small = `${clientVars.webrtc.video.sizes.small}px`;
      }
      self.init(context.pad);
      callback();
    },
    // so we can call it from testing
    setUrlParamString: (str) => {
      urlParamString = str;
    },
    aceSetAuthorStyle: (hook, context, callback) => {
      if (context.author) {
        const user = self.getUserFromId(context.author);
        if (user) {
          $(`#video_${context.author.replace(/\./g, '_')}`).css({
            'border-color': user.colorId,
          }).siblings('.user-name').text(user.name);
        }
      }
      callback();
    },
    userJoinOrUpdate: (hook, context, callback) => {
      /*
      var userId = context.userInfo.userId;
      console.log('userJoinOrUpdate', context, context.userInfo.userId, pc[userId]);
      */
      callback();
    },
    userLeave: (hook, context, callback) => {
      const userId = context.userInfo.userId;
      // console.log('user left, hang up', userId, context, pc[userId]);
      if (userId && pc[userId]) {
        self.hangup(userId, false);
      }
      callback();
    },
    handleClientMessage_RTC_MESSAGE: (hook, context, callback) => {
      if (isActive) {
        self.receiveMessage(context.payload);
      }
      callback([null]);
    },
    // END OF API HOOKS
    show: () => {
      $('#rtcbox').css('display', 'flex');
    },
    showUserMediaError: (err) => { // show an error returned from getUserMedia
      let reason;
      // For reference on standard errors returned by getUserMedia:
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
      // However keep in mind that we add our own errors in getUserMediaPolyfill
      switch (err.name) {
        case 'CustomNotSupportedError':
          reason = `${html10n.get('pad.ep_webrtc.error.notSupported.sorry')
          } - ${
            html10n.get('pad.ep_webrtc.error.notSupported.howTo')
          } - <a href="http://www.webrtc.org/" target="_new">${
            html10n.get('pad.ep_webrtc.error.notSupported.findOutMore')
          }</a>`;
          self.sendErrorStat('NotSupported');
          break;
        case 'CustomSecureConnectionError':
          reason = html10n.get('pad.ep_webrtc.error.ssl');
          self.sendErrorStat('SecureConnection');
          break;
        case 'NotAllowedError':
          // For certain (I suspect older) browsers, `NotAllowedError` indicates either an
          // insecure connection or the user rejecting camera permissions.
          // The error for both cases appears to be identical, so our best guess at telling
          // them apart is to guess whether we are in a secure context.
          // (webrtc is considered secure for https connections or on localhost)
          if (location.protocol === 'https:' ||
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1') {
            reason = html10n.get('pad.ep_webrtc.error.permission');
            self.sendErrorStat('Permission');
          } else {
            reason = html10n.get('pad.ep_webrtc.error.ssl');
            self.sendErrorStat('SecureConnection');
          }
          break;
        case 'NotFoundError':
          reason = html10n.get('pad.ep_webrtc.error.notFound');
          self.sendErrorStat('NotFound');
          break;
        case 'NotReadableError':
          // `err.message` might give useful info to the user (not necessarily
          // useful for other error messages)
          reason = `${html10n.get('pad.ep_webrtc.error.notReadable')}<br><br>${err.message}`;
          self.sendErrorStat('Hardware');
          break;
        case 'AbortError':
          // `err.message` might give useful info to the user (not necessarily useful for
          // other error messages)
          reason = `${html10n.get('pad.ep_webrtc.error.otherCantAccess')}<br><br>${err.message}`;
          self.sendErrorStat('Abort');
          break;
        default:
          // `err` as a string might give useful info to the user
          // (not necessarily useful for other error messages)
          reason = `${html10n.get('pad.ep_webrtc.error.other')}<br><br>${err}`;
          self.sendErrorStat('Unknown');
      }
      $.gritter.add({
        title: 'Error',
        text: reason,
        sticky: true,
        class_name: 'error',
      });
      self.hide();
    },
    hide: () => {
      $('#rtcbox').hide();
    },
    activate: () => {
      $('#options-enablertc').prop('checked', true);
      if (isActive) return Promise.resolve();
      self.show();
      padcookie.setPref('rtcEnabled', true);
      isActive = true;
      return self.getUserMedia();
    },
    deactivate: () => {
      $('#options-enablertc').prop('checked', false);
      if (!isActive) return;
      self.hide();
      padcookie.setPref('rtcEnabled', false);
      self.hangupAll();
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];
        self.setStream(self._pad.getUserId(), '');
        if ((videoTrack && videoTrack.stop === undefined) ||
          (audioTrack && audioTrack.stop === undefined)) {
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
    toggleMuted: () => {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled; // returning "Muted" state, which is !enabled
      }
      return true; // if there's no audio track, it's muted
    },
    toggleVideo: () => {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return !videoTrack.enabled; // returning whether it's disabled, to match toggleMuted
      }
      // if there's no video track, return true to indicate not enabled (matching toggleMuted)
      return true;
    },
    getUserFromId: (userId) => {
      if (!self._pad || !self._pad.collabClient) return null;
      const result = self._pad.collabClient
          .getConnectedUsers()
          .filter((user) => user.userId === userId);
      const user = result.length > 0 ? result[0] : null;
      // if (user && userId == self.getUserId()) user.name = "Me";
      // Commented by JM because it made every user name "Me"
      return user;
    },
    setStream: (userId, stream) => {
      const isLocal = userId === self.getUserId();
      const videoId = `video_${userId.replace(/\./g, '_')}`;
      let video = $(`#${videoId}`)[0];

      const user = self.getUserFromId(userId);

      if (!video && stream) {
        const videoContainer = $("<div class='video-container'>")
            .css({
              'width': videoSizes.small,
              'max-height': videoSizes.small,
            })
            .appendTo($('#rtcbox'));

        videoContainer.append($('<div class="user-name">').text(user.name));

        video = $('<video playsinline>')
            .attr('id', videoId)
            .css({
              'border-color': user.colorId,
              'width': videoSizes.small,
              'max-height': videoSizes.small,
            })
            .on({
              loadedmetadata: () => {
                self.addInterface(userId, stream);
              },
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
    addInterface: (userId, stream) => {
      const isLocal = userId === self.getUserId();
      const videoId = `video_${userId.replace(/\./g, '_')}`;
      const $video = $(`#${videoId}`);

      // /////
      // Mute button
      // /////

      const audioTrack = stream.getAudioTracks()[0];
      const audioHardDisabled = clientVars.webrtc.audio.disabled === 'hard';
      let initiallyMuted = true; // if there's no audio track, it's muted
      if (audioTrack) {
        initiallyMuted = !audioTrack.enabled;
      }

      const $mute = $("<span class='interface-btn audio-btn buttonicon'>")
          .attr('title',
              audioHardDisabled
                ? 'Audio disallowed by admin'
                : (initiallyMuted ? 'Unmute' : 'Mute')
          )
          .toggleClass('muted', initiallyMuted || audioHardDisabled)
          .toggleClass('disallowed', audioHardDisabled);

      if (!audioHardDisabled) {
        $mute.on({
          click: (event) => {
            let muted;
            if (isLocal) {
              muted = self.toggleMuted();
            } else {
              $video[0].muted = !$video[0].muted;
              muted = $video[0].muted;
            }
            $mute
                .attr('title', muted ? 'Unmute' : 'Mute')
                .toggleClass('muted', muted);
          },
        });
      }

      // /////
      // Disable Video button
      // /////

      let $disableVideo = null;
      if (isLocal) {
        const videoTrack = stream.getVideoTracks()[0];
        const videoHardDisabled = clientVars.webrtc.video.disabled === 'hard';
        let initiallyVideoEnabled = false; // if there's no video track, it's disabled
        if (videoTrack) {
          initiallyVideoEnabled = videoTrack.enabled;
        }
        $disableVideo = $("<span class='interface-btn video-btn buttonicon'>")
            .attr('title',
                videoHardDisabled
                  ? 'Video disallowed by admin'
                  : (initiallyVideoEnabled ? 'Disable video' : 'Enable video'
                    )
            )
            .toggleClass('off', !initiallyVideoEnabled || videoHardDisabled)
            .toggleClass('disallowed', videoHardDisabled);
        if (!videoHardDisabled) {
          $disableVideo.on({
            click: (event) => {
              const videoEnabled = !self.toggleVideo();
              $disableVideo
                  .attr(
                      'title',
                      videoEnabled ? 'Disable video' : 'Enable video'
                  )
                  .toggleClass('off', !videoEnabled);
            },
          });
        }
      }

      // /////
      // Enlarge Video button
      // /////

      let videoEnlarged = false;
      const $largeVideo = $("<span class='interface-btn enlarge-btn buttonicon'>")
          .attr('title', 'Make video larger')
          .on({
            click: (event) => {
              videoEnlarged = !videoEnlarged;

              if (videoEnlarged) {
                enlargedVideos.add(userId);
              } else {
                enlargedVideos.delete(userId);
              }

              $largeVideo
                  .attr(
                      'title',
                      videoEnlarged ? 'Make video smaller' : 'Make video larger'
                  )
                  .toggleClass('large', videoEnlarged);

              const videoSize = videoEnlarged ? videoSizes.large : videoSizes.small;
              $video.parent().css({'width': videoSize, 'max-height': videoSize});
              $video.css({'width': videoSize, 'max-height': videoSize});
            },
          });


      // /////
      // Combining
      // /////

      $(`#interface_${videoId}`).remove();
      $("<div class='interface-container'>")
          .attr('id', `interface_${videoId}`)
          .append($mute)
          .append($disableVideo)
          .append($largeVideo)
          .insertAfter($video);
    },
    // Sends a stat to the back end. `statName` must be in the
    // approved list on the server side.
    sendErrorStat: (statName) => {
      const msg = {component: 'pad',
        type: 'STATS',
        data: {statName, type: 'RTC_MESSAGE'}};
      pad.socket.json.send(msg);
    },
    sendMessage: (to, data) => {
      self._pad.collabClient.sendMessage({
        type: 'RTC_MESSAGE',
        payload: {data, to},
      });
    },
    receiveMessage: (msg) => {
      const peer = msg.from;
      const data = msg.data;
      const type = data.type;
      if (peer === self.getUserId()) {
        // console.log('ignore own messages');
        return;
      }
      /*
      if (type != 'icecandidate')
        console.log('receivedMessage', 'peer', peer, 'type', type, 'data', data);
      */
      if (type === 'hangup') {
        self.hangup(peer, false);
      } else if (type === 'offer') {
        if (pc[peer]) {
          console.log('existing connection?', pc[peer]);
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
        const offer = new RTCSessionDescription(data.offer);
        pc[peer].setRemoteDescription(
            offer,
            () => {
              pc[peer].createAnswer(
                  (desc) => {
                    desc.sdp = cleanupSdp(desc.sdp);
                    pc[peer].setLocalDescription(
                        desc,
                        () => {
                          self.sendMessage(peer, {type: 'answer', answer: desc});
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
      } else if (type === 'answer') {
        if (pc[peer]) {
          const answer = new RTCSessionDescription(data.answer);
          pc[peer].setRemoteDescription(answer, () => {}, logError);
        }
      } else if (type === 'icecandidate') {
        if (pc[peer]) {
          const candidate = new RTCIceCandidate(data.candidate);
          const p = pc[peer].addIceCandidate(candidate);
          if (p) {
            p.then(() => {
              // Do stuff when the candidate is successfully passed to the ICE agent
            }).catch(() => {
              console.log('Error: Failure during addIceCandidate()', data);
            });
          }
        }
      } else {
        console.log('unknown message', data);
      }
    },
    hangupAll: () => {
      Object.keys(pc).forEach((userId) => {
        self.hangup(userId);
      });
    },
    getUserId: () => self._pad && self._pad.getUserId(),
    hangup: (...args) => {
      const userId = args[0];
      const notify = args[1] || true;
      if (pc[userId] && userId !== self.getUserId()) {
        self.setStream(userId, '');
        pc[userId].close();
        delete pc[userId];
        notify && self.sendMessage(userId, {type: 'hangup'});
      }
    },
    call: (userId) => {
      if (!localStream) {
        callQueue.push(userId);
        return;
      }
      let constraints = {optional: [], mandatory: {}};
      // temporary measure to remove Moz* constraints in Chrome
      if (webrtcDetectedBrowser === 'chrome') {
        for (const prop in constraints.mandatory) {
          if (prop.indexOf('Moz') !== -1) {
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
          (desc) => {
            desc.sdp = cleanupSdp(desc.sdp);
            pc[userId].setLocalDescription(
                desc,
                () => {
                  self.sendMessage(userId, {type: 'offer', offer: desc});
                },
                logError
            );
          },
          logError,
          constraints
      );
    },
    createPeerConnection: (userId) => {
      if (pc[userId]) {
        console.log(
            'WARNING creating PC connection even though one exists',
            userId
        );
      }
      pc[userId] = new RTCPeerConnection(pc_config, pc_constraints);
      pc[userId].onicecandidate = (event) => {
        if (event.candidate) {
          self.sendMessage(userId, {
            type: 'icecandidate',
            candidate: event.candidate,
          });
        }
      };
      pc[userId].onaddstream = (event) => {
        remoteStream[userId] = event.stream;
        self.setStream(userId, event.stream);
      };
      pc[userId].onremovestream = (event) => {
        self.setStream(userId, '');
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
    getUserMedia: () => {
      const mediaConstraints = {
        audio: clientVars.webrtc.audio.disabled !== 'hard',
        video: clientVars.webrtc.video.disabled !== 'hard' && {
          optional: [],
          mandatory: {
            maxWidth: 320,
            maxHeight: 240,
          },
        },
      };
      if (padcookie.getPref('fakeWebrtcFirefox')) {
        // The equivalent is done for chromium with cli option:
        // --use-fake-device-for-media-stream
        mediaConstraints.fake = true;
      }
      return window.navigator.mediaDevices
          .getUserMedia(mediaConstraints)
          .then((stream) => {
          // Disable audio and/or video according to user/site settings.
          // Do this before setting `localStream` to avoid a race condition
          // that might flash the video on for an instant before disabling it.
            const audioTrack = stream.getAudioTracks()[0];
            // using `.prop("checked") === true` to make absolutely sure the result is a boolean
            // we don't want bugs when it comes to muting/turning off video
            if (audioTrack) {
              audioTrack.enabled = $('#options-audioenabledonstart').prop('checked') === true;
            }
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              videoTrack.enabled = $('#options-videoenabledonstart').prop('checked') === true;
            }

            localStream = stream;
            self.setStream(self._pad.getUserId(), stream);
            self._pad.collabClient.getConnectedUsers().forEach((user) => {
              if (user.userId !== self.getUserId()) {
                if (pc[user.userId]) {
                  self.hangup(user.userId);
                }
                self.call(user.userId);
              }
            });
          })
          .catch((err) => { self.showUserMediaError(err); });
    },
    avInURL: () => {
      if (urlParamString.indexOf('av=YES') > -1) {
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
    settingToCheckbox(params) {
      if (params.urlVar === undefined) { throw Error('missing urlVar in settingToCheckbox'); }
      if (params.cookie === undefined) { throw Error('missing cookie in settingToCheckbox'); }
      if (params.defaultVal === undefined) {
        throw Error('missing defaultVal in settingToCheckbox');
      }
      if (params.checkboxId === undefined) {
        throw Error('missing checkboxId in settingToCheckbox');
      }

      let value;

      // * If the setting is in the URL: use it, and also set the cookie
      // * If the setting is not in the URL: try to get it from the cookie
      // * If the setting was in neither, go with the site-wide default value
      //   but don't put it in the cookies
      if (urlParamString.indexOf(`${params.urlVar}=true`) > -1) {
        padcookie.setPref(params.cookie, true);
        value = true;
      } else if (urlParamString.indexOf(`${params.urlVar}=false`) > -1) {
        padcookie.setPref(params.cookie, false);
        value = false;
      } else {
        value = padcookie.getPref(params.cookie);
        if (typeof value === 'undefined') {
          value = params.defaultVal;
        }
      }

      $(params.checkboxId).prop('checked', value);

      // If the user changes the checkbox, set the cookie accordingly
      $(params.checkboxId).on('change', function () {
        padcookie.setPref(params.cookie, this.checked);
      });
    },
    setupCheckboxes: (pad) => {
      // The checkbox shouldn't even exist if audio is not allowed
      if (clientVars.webrtc.audio.disabled !== 'hard') {
        self.settingToCheckbox({
          urlVar: 'webrtcaudioenabled',
          cookie: 'audioEnabledOnStart',
          defaultVal: clientVars.webrtc.audio.disabled === 'none',
          checkboxId: '#options-audioenabledonstart',
        });
      }

      // The checkbox shouldn't even exist if video is not allowed
      if (clientVars.webrtc.video.disabled !== 'hard') {
        self.settingToCheckbox({
          urlVar: 'webrtcvideoenabled',
          cookie: 'videoEnabledOnStart',
          defaultVal: clientVars.webrtc.video.disabled === 'none',
          checkboxId: '#options-videoenabledonstart',
        });
      }
    },
    init(pad) {
      self._pad = pad || window.pad;

      self.setupCheckboxes();

      // TODO - add this to setupCheckboxes. it's a bit involved.
      let rtcEnabled = padcookie.getPref('rtcEnabled');
      if (typeof rtcEnabled === 'undefined') {
        rtcEnabled = $('#options-enablertc').prop('checked');
      }

      // if a URL Parameter is set then activate
      if (self.avInURL()) self.activate();

      if (clientVars.webrtc.listenClass) {
        $(clientVars.webrtc.listenClass).on('click', () => {
          self.activate();
        });
      }

      if (rtcEnabled) {
        self.activate();
      } else {
        self.deactivate();
      }
      $('#options-enablertc').on('change', function () {
        if (this.checked) {
          self.activate();
        } else {
          self.deactivate();
        }
      });
      if (isActive) {
        $(window).on('unload', () => {
          self.hangupAll();
        });
      }
    },
  };

  // Normalize RTC implementation between browsers
  const attachMediaStream = (element, stream) => {
    if (typeof element.srcObject !== 'undefined') {
      element.srcObject = stream;
    } else if (typeof element.mozSrcObject !== 'undefined') {
      element.mozSrcObject = stream;
    } else if (typeof element.src !== 'undefined') {
      element.src = URL.createObjectURL(stream);
    } else {
      console.log('Error attaching stream to element.', element);
    }
  };
  const webrtcDetectedBrowser = 'chrome';

  // Set Opus as the default audio codec if it's present.
  const preferOpus = (sdp) => {
    let sdpLines = sdp.split('\r\n');
    let mLineIndex;

    // Search for m line.
    for (let i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('m=audio') !== -1) {
        mLineIndex = i;
        break;
      }
    }
    if (mLineIndex == null) return sdp;

    // If Opus is available, set it as the default in m line.
    for (let i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        const opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        if (opusPayload) {
          sdpLines[mLineIndex] = setDefaultCodec(
              sdpLines[mLineIndex],
              opusPayload
          );
        }
        break;
      }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
  };

  const extractSdp = (sdpLine, pattern) => {
    const result = sdpLine.match(pattern);
    return result && result.length === 2 ? result[1] : null;
  };

  // Set the selected codec to the first in m line.
  const setDefaultCodec = (mLine, payload) => {
    const elements = mLine.split(' ');
    const newLine = [];
    let index = 0;
    for (let i = 0; i < elements.length; i++) {
      // Format of media starts from the fourth.
      if (index === 3) newLine[index++] = payload; // Put target payload to the first.
      if (elements[i] !== payload) newLine[index++] = elements[i];
    }
    return newLine.join(' ');
  };

  // Strip CN from sdp before CN constraints is ready.
  const removeCN = (sdpLines, mLineIndex) => {
    const mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (let i = sdpLines.length - 1; i >= 0; i--) {
      const payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
      if (payload) {
        const cnPos = mLineElements.indexOf(payload);
        if (cnPos !== -1) {
          // Remove CN payload from m line.
          mLineElements.splice(cnPos, 1);
        }
        // Remove CN line in sdp
        sdpLines.splice(i, 1);
      }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
  };

  const sdpRate = (sdp, rate) => {
    rate = rate || 1638400;
    return sdp.replace(/b=AS:\d+\r/g, `b=AS:${rate}\r`);
  };

  const cleanupSdp = (sdp) => {
    sdp = preferOpus(sdp);
    sdp = sdpRate(sdp);
    return sdp;
  };

  const mergeConstraints = (cons1, cons2) => {
    const merged = cons1;
    for (const name of Object.keys(cons2.mandatory)) {
      merged.mandatory[name] = cons2.mandatory[name];
    }
    merged.optional.concat(cons2.optional);
    return merged;
  };

  const logError = (error) => console.log('WebRTC ERROR:', error);

  self.pc = pc;
  return self;
})();

exports.rtc = rtc;
window.ep_webrtc = rtc;
// Access to do some unit tests. If there's a more formal way to do this for all plugins,
// we can change to that.
