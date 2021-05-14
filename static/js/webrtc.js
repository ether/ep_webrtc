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
const padcookie = require('ep_etherpad-lite/static/js/pad_cookie').padcookie;

const rtc = (() => {
  const videoSizes = {large: '260px', small: '160px'};
  let isActive = false;
  let urlParamString;
  const pcConfig = {};
  let localStream;
  const pc = {};

  const self = {
    // API HOOKS
    postAceInit: async (hookName, {pad}) => {
      self.setUrlParamString(window.location.search);
      if (clientVars.webrtc == null || clientVars.webrtc.configError) {
        $.gritter.add({
          title: 'Error',
          text: 'Ep_webrtc: There is an error with the configuration of this plugin. Please ' +
              'inform the administrators of this site. They will see the details in their logs.',
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
      pcConfig.iceServers =
        clientVars.webrtc && clientVars.webrtc.iceServers
          ? clientVars.webrtc.iceServers
          : [{urls: ['stun:stun.l.google.com:19302']}];
      if (clientVars.webrtc.video.sizes.large) {
        videoSizes.large = `${clientVars.webrtc.video.sizes.large}px`;
      }
      if (clientVars.webrtc.video.sizes.small) {
        videoSizes.small = `${clientVars.webrtc.video.sizes.small}px`;
      }
      self.init(pad);
    },
    // so we can call it from testing
    setUrlParamString: (str) => {
      urlParamString = str;
    },
    aceSetAuthorStyle: (hookName, {author}) => {
      if (!author) return;
      const user = self.getUserFromId(author);
      if (!user) return;
      $(`#video_${author.replace(/\./g, '_')}`)
          .css({'border-color': user.colorId})
          .siblings('.user-name').text(user.name);
    },
    userLeave: (hookName, {userInfo: {userId}}) => {
      self.hangup(userId, false);
    },
    handleClientMessage_RTC_MESSAGE: (hookName, {payload}) => {
      if (isActive) self.receiveMessage(payload);
      return [null];
    },
    // END OF API HOOKS
    showUserMediaError: (err) => { // show an error returned from getUserMedia
      let reason;
      // For reference on standard errors returned by getUserMedia:
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
      switch (err.name) {
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
          reason = $('<div>')
              .append($('<p>').text(html10n.get('pad.ep_webrtc.error.notReadable')))
              .append($('<p>').text(err.message));
          self.sendErrorStat('Hardware');
          break;
        case 'AbortError':
          // `err.message` might give useful info to the user (not necessarily useful for
          // other error messages)
          reason = $('<div>')
              .append($('<p>').text(html10n.get('pad.ep_webrtc.error.otherCantAccess')))
              .append($('<p>').text(err.message));
          self.sendErrorStat('Abort');
          break;
        default:
          // Let Etherpad's error handling handle the error.
          throw err;
      }
      $.gritter.add({
        title: 'Error',
        text: reason,
        sticky: true,
        class_name: 'error',
      });
    },
    activate: async () => {
      $('#options-enablertc').prop('checked', true);
      if (isActive) return;
      $('#rtcbox').css('display', 'flex');
      padcookie.setPref('rtcEnabled', true);
      isActive = true;
      const constraints = {
        audio: clientVars.webrtc.audio.disabled !== 'hard',
        video: clientVars.webrtc.video.disabled !== 'hard' && {
          width: {max: 320},
          height: {max: 240},
        },
      };
      if (padcookie.getPref('fakeWebrtcFirefox')) {
        // The equivalent is done for chromium with cli option:
        // --use-fake-device-for-media-stream
        constraints.fake = true;
      }
      let stream;
      try {
        stream = await window.navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        try {
          self.showUserMediaError(err);
        } finally {
          self.deactivate();
        }
        return;
      }
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
        if (user.userId === self.getUserId()) return;
        if (pc[user.userId]) self.hangup(user.userId);
        self.call(user.userId);
      });
    },
    deactivate: () => {
      $('#options-enablertc').prop('checked', false);
      if (!isActive) return;
      $('#rtcbox').hide();
      padcookie.setPref('rtcEnabled', false);
      self.hangupAll();
      if (localStream) {
        self.setStream(self._pad.getUserId(), null);
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
      }
      isActive = false;
    },
    toggleMuted: () => {
      const audioTrack = localStream.getAudioTracks()[0];
      if (!audioTrack) return true; // if there's no audio track, it's muted
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // returning "Muted" state, which is !enabled
    },
    toggleVideo: () => {
      const videoTrack = localStream.getVideoTracks()[0];
      if (!videoTrack) return true; // if there's no video track, it's disabled
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // returning whether it's disabled, to match toggleMuted
    },
    getUserFromId: (userId) => {
      if (!self._pad || !self._pad.collabClient) return null;
      const result = self._pad.collabClient
          .getConnectedUsers()
          .filter((user) => user.userId === userId);
      const user = result.length > 0 ? result[0] : null;
      return user;
    },
    setStream: (userId, stream) => {
      const isLocal = userId === self.getUserId();
      const videoId = `video_${userId.replace(/\./g, '_')}`;
      let video = $(`#${videoId}`)[0];

      const user = self.getUserFromId(userId);

      if (!video && stream) {
        const size = videoSizes.small;
        const videoContainer = $("<div class='video-container'>")
            .css({'width': size, 'max-height': size})
            .appendTo($('#rtcbox'));

        videoContainer.append($('<div class="user-name">').text(user.name));

        video = $('<video playsinline>')
            .attr('id', videoId)
            .css({'border-color': user.colorId, 'width': size, 'max-height': size})
            .appendTo(videoContainer)[0];

        video.autoplay = true;
        if (isLocal) {
          videoContainer.addClass('local-user');
          video.muted = true;
        }
        self.addInterface(userId, stream);
      }
      if (stream) {
        video.srcObject = stream;
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
    receiveMessage: async (msg) => {
      const peer = msg.from;
      const data = msg.data;
      const type = data.type;
      if (peer === self.getUserId()) {
        return;
      }
      if (type === 'hangup') {
        self.hangup(peer, false);
      } else if (type === 'offer') {
        if (pc[peer]) self.hangup(peer, false);
        self.createPeerConnection(peer);
        if (localStream && !pc[peer].getSenders().length) {
          for (const track of localStream.getTracks()) pc[peer].addTrack(track, localStream);
        }
        await pc[peer].setRemoteDescription(data.offer);
        await pc[peer].setLocalDescription();
        self.sendMessage(peer, {type: 'answer', answer: pc[peer].localDescription});
      } else if (type === 'answer') {
        if (pc[peer]) await pc[peer].setRemoteDescription(data.answer);
      } else if (type === 'icecandidate') {
        if (pc[peer] && data.candidate) await pc[peer].addIceCandidate(data.candidate);
      } else {
        console.log('unknown message', data);
      }
    },
    hangupAll: () => {
      Object.keys(pc).forEach((userId) => {
        self.hangup(userId);
      });
    },
    getUserId: () => self._pad.getUserId(),
    hangup: (userId, notify = true) => {
      if (!pc[userId]) return;
      self.setStream(userId, null);
      pc[userId].close();
      delete pc[userId];
      notify && self.sendMessage(userId, {type: 'hangup'});
    },
    call: async (userId) => {
      if (!localStream) return;
      if (!pc[userId]) {
        self.createPeerConnection(userId);
      }
      for (const track of localStream.getTracks()) pc[userId].addTrack(track, localStream);
      await pc[userId].setLocalDescription();
      self.sendMessage(userId, {type: 'offer', offer: pc[userId].localDescription});
    },
    createPeerConnection: (userId) => {
      if (pc[userId]) {
        console.log(
            'WARNING creating PC connection even though one exists',
            userId
        );
      }
      pc[userId] = new RTCPeerConnection(pcConfig);
      pc[userId].onicecandidate = (event) => {
        if (event.candidate) {
          self.sendMessage(userId, {
            type: 'icecandidate',
            candidate: event.candidate,
          });
        }
      };
      let stream = null;
      pc[userId].addEventListener('track', (e) => {
        if (e.streams.length !== 1) throw new Error('Expected track to be in exactly one stream');
        const trackStream = e.streams[0];
        if (stream == null) {
          stream = trackStream;
          stream.addEventListener('removetrack', (e) => {
            if (stream !== trackStream) throw new Error('removetrack event for old stream');
            if (stream.getTracks().length > 0) return;
            stream = null;
            self.setStream(userId, null);
          });
          self.setStream(userId, stream);
        } else if (stream !== trackStream) {
          throw new Error('New track associated with unexpected stream');
        }
      });
    },
    avInURL: () => urlParamString.includes('av=YES'),

    // Connect a setting to a checkbox. To be called on initialization.
    //
    // It will check for the value in urlVar, cookie, and the site-wide
    //   default value, in that order
    // If urlVar is found, it will also set the cookie
    // Finally, it sets up to set cookie if the user changes the setting in the gearbox
    settingToCheckbox: (params) => {
      for (const prop of ['checkboxId', 'cookie', 'defaultVal', 'urlVar']) {
        if (params[prop] == null) throw new Error(`missing ${prop} in settingToCheckbox`);
      }

      let value;

      // * If the setting is in the URL: use it, and also set the cookie
      // * If the setting is not in the URL: try to get it from the cookie
      // * If the setting was in neither, go with the site-wide default value
      //   but don't put it in the cookies
      if (urlParamString.includes(`${params.urlVar}=true`)) {
        padcookie.setPref(params.cookie, true);
        value = true;
      } else if (urlParamString.includes(`${params.urlVar}=false`)) {
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
    setupCheckboxes: () => {
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
    init: (pad) => {
      self._pad = pad;

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
      $('#rtcbox').data('initialized', true); // Help tests determine when init() is done.
    },
  };

  self.pc = pc;
  return self;
})();

exports.rtc = rtc;
window.ep_webrtc = rtc;
// Access to do some unit tests. If there's a more formal way to do this for all plugins,
// we can change to that.
