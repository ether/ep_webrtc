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

class LocalTracks extends EventTarget {
  constructor() {
    super();
    Object.defineProperty(this, 'stream', {value: new MediaStream(), writeable: false});
    this._tracks = new Map();
  }

  setTrack(kind, newTrack) {
    newTrack = newTrack || null; // Convert undefined to null.
    let oldTrack = null;
    const tracks =
          kind === 'audio' ? this.stream.getAudioTracks()
          : kind === 'video' ? this.stream.getVideoTracks()
          : this.stream.getTracks();
    for (const track of tracks) {
      if (track.kind !== kind) continue;
      if (track === newTrack) return; // No change.
      oldTrack = track;
      this.stream.removeTrack(oldTrack);
      break;
    }
    if (newTrack != null) this.stream.addTrack(newTrack);
    this.dispatchEvent(Object.assign(new CustomEvent('trackchanged'), {oldTrack, newTrack}));
    if (oldTrack != null) oldTrack.stop();
  }
}

class StreamEvent extends CustomEvent {
  constructor(type, stream) {
    super(type, {detail: stream});
    this.stream = stream;
  }
}

class ClosedEvent extends CustomEvent {
  constructor() {
    super('closed');
  }
}

// Events:
//   * 'stream' (see StreamEvent): Emitted when the remote stream is ready. For every 'stream' event
//     there will be a corresponding 'streamgone' event. Once a stream is added another stream will
//     not be added until after the original stream is removed.
//   * 'streamgone' (see StreamEvent): Emitted when the remote stream goes away, including when the
//     PeerState is closed.
//   * 'closed' (see ClosedEvent): Emitted when the PeerState is closed, except when closed by a
//     call to close(). The PeerState must not be used after it is closed.
class PeerState extends EventTarget {
  constructor(pcConfig, sendMessage, localTracks) {
    super();
    this._pcConfig = pcConfig;
    this._sendMessage = sendMessage;
    this._localTracks = localTracks;
    this._closed = false;
    this._pc = null;
    this._remoteStream = null;
    this._onremovetrack =
        () => { if (this._remoteStream.getTracks().length === 0) this._setRemoteStream(null); };

    this._resetConnection();

    this._ontrackchanged = async ({oldTrack, newTrack}) => {
      if (oldTrack != null) {
        for (const sender of this._pc.getSenders()) {
          if (sender.track !== oldTrack) continue;
          if (newTrack != null) {
            try {
              return await sender.replaceTrack(newTrack);
            } catch (err) {
              // Renegotiation is required.
            }
          }
          this._pc.removeTrack(sender);
          break;
        }
      }
      if (newTrack != null) this._pc.addTrack(newTrack, this._localTracks.stream);
    };
    this._localTracks.addEventListener('trackchanged', this._ontrackchanged);
  }

  _setRemoteStream(stream) {
    if (stream == null) {
      if (this._remoteStream == null) return;
      const oldStream = this._remoteStream;
      oldStream.removeEventListener('removetrack', this._onremovetrack);
      this._remoteStream = null;
      this.dispatchEvent(new StreamEvent('streamgone', oldStream));
    } else if (this._remoteStream == null) {
      this._remoteStream = stream;
      stream.addEventListener('removetrack', this._onremovetrack);
      this.dispatchEvent(new StreamEvent('stream', stream));
    } else if (stream !== this._remoteStream) {
      throw new Error('New remote stream added before old stream was removed');
    }
  }

  _resetConnection() {
    this._setRemoteStream(null);
    const pc = new RTCPeerConnection(this._pcConfig);
    pc.addEventListener('track', ({track, streams}) => {
      if (streams.length !== 1) throw new Error('Expected track to be in exactly one stream');
      this._setRemoteStream(streams[0]);
    });
    pc.addEventListener('icecandidate', ({candidate}) => this._sendMessage({candidate}));
    pc.addEventListener('negotiationneeded', async () => {
      await pc.setLocalDescription();
      this._sendMessage({description: pc.localDescription});
    });
    pc.addEventListener('connectionstatechange', () => {
      switch (pc.connectionState) {
        case 'closed': this.close(true); break;
        // From reading the spec it is not clear what the possible state transitions are, but it
        // seems that on at least Chrome 90 the 'failed' state is terminal (it can never go back to
        // working).
        case 'failed': this.close(true); break;
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      switch (pc.iceConnectionState) {
        case 'closed': this.close(true); break;
        case 'failed': pc.restartIce(); break;
      }
    });

    if (this._pc != null) this._pc.close();
    this._pc = pc;

    const tracks = this._localTracks.stream.getTracks();
    for (const track of tracks) pc.addTrack(track, this._localTracks.stream);
    // Creating an RTCPeerConnection doesn't actually generate any control messages until
    // RTCPeerConnection.addTrack() is called. It is possible that the last invite sent to the peer
    // was sent before the peer was ready to accept invites. If that is the case and there are no
    // local tracks to trigger a WebRTC message exchange, the peer won't know that it is OK to
    // connect back. Send another invite just in case. The peer will ignore any superfluous invites.
    if (tracks.length === 0) this._sendMessage({invite: 'invite'});
  }

  async receiveMessage({candidate, description, hangup}) {
    if (this._closed) throw new Error('Unable to process message because PeerState is closed');
    if (hangup != null) {
      this.close(true);
      return;
    }
    if (description != null) {
      await this._pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await this._pc.setLocalDescription();
        this._sendMessage({description: this._pc.localDescription});
      }
    }
    if (candidate != null) {
      await this._pc.addIceCandidate(candidate);
    }
  }

  close(emitClosedEvent = false) {
    if (this._closed) return;
    this._closed = true;
    this._localTracks.removeEventListener('trackchanged', this._ontrackchanged);
    this._pc.close();
    this._pc = null;
    this._setRemoteStream(null);
    this._sendMessage({hangup: 'hangup'});
    if (emitClosedEvent) this.dispatchEvent(new ClosedEvent());
  }
}

// Toggles the enabled state of the first track, then updates the other tracks to match. Returns
// true iff the result is no enabled tracks (either there are no tracks or all tracks are muted).
const toggleTracks = (tracks) => {
  const [{enabled: enabledBefore = true} = {}] = tracks;
  const enabledAfter = !enabledBefore;
  for (const track of tracks) track.enabled = enabledAfter;
  return !enabledAfter; // Return true iff disabled (muted).
};

// Periods in element IDs make it hard to build a selector string because period is for class match.
const getVideoId = (userId) => `video_${userId.replace(/\./g, '_')}`;

exports.rtc = new class {
  constructor() {
    this._settings = null;
    this._isActive = false;
    this._localTracks = new LocalTracks();
    this._pad = null;
    this._peers = new Map();
  }

  // API HOOKS

  async postAceInit(hookName, {pad}) {
    this._pad = pad;
    this._settings = clientVars.webrtc;
    if (this._settings == null || this._settings.configError) {
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

    this.settingToCheckbox({
      urlVar: 'av',
      cookie: 'rtcEnabled',
      defaultVal: this._settings.enabled,
      checkboxId: '#options-enablertc',
    });
    if (this._settings.audio.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcaudioenabled',
        cookie: 'audioEnabledOnStart',
        defaultVal: this._settings.audio.disabled === 'none',
        checkboxId: '#options-audioenabledonstart',
      });
    }
    if (this._settings.video.disabled !== 'hard') {
      this.settingToCheckbox({
        urlVar: 'webrtcvideoenabled',
        cookie: 'videoEnabledOnStart',
        defaultVal: this._settings.video.disabled === 'none',
        checkboxId: '#options-videoenabledonstart',
      });
    }

    if (this._settings.listenClass) {
      $(this._settings.listenClass).on('click', async () => {
        await this.activate();
      });
    }
    $('#options-enablertc').on('change', async (event) => {
      if (event.currentTarget.checked) {
        await this.activate();
      } else {
        this.deactivate();
      }
    });
    $(window).on('beforeunload', () => { this.hangupAll(); });
    $(window).on('unload', () => { this.hangupAll(); });
    if ($('#options-enablertc').prop('checked')) {
      await this.activate();
    } else {
      this.deactivate();
    }
    $('#rtcbox').data('initialized', true); // Help tests determine when initialization is done.
  }

  userJoinOrUpdate(hookName, {userInfo}) {
    const {userId} = userInfo;
    if (!this._isActive || !userId) return;
    if (userId !== this.getUserId()) this.invitePeer(userId);
    this.updatePeerNameAndColor(userInfo);
  }

  userLeave(hookName, {userInfo: {userId}}) {
    this.hangup(userId);
  }

  handleClientMessage_RTC_MESSAGE(hookName, {payload: {from, data}}) {
    if (this._isActive && from !== this.getUserId() &&
        (this._peers.has(from) || data.hangup == null)) {
      this.getPeerConnection(from).receiveMessage(data);
    }
    return [null];
  }

  // END OF API HOOKS

  updatePeerNameAndColor(userInfo) {
    if (!userInfo) return;
    const {userId, name = html10n.get('pad.userlist.unnamed'), colorId = 0} = userInfo;
    const color = typeof colorId === 'number' ? clientVars.colorPalette[colorId] : colorId;
    $(`#${getVideoId(userId)}`)
        .css({'border-color': color})
        .siblings('.user-name').text(name);
  }

  showUserMediaError(err) { // show an error returned from getUserMedia
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
          this.sendErrorStat('Permission');
        } else {
          reason = html10n.get('pad.ep_webrtc.error.ssl');
          this.sendErrorStat('SecureConnection');
        }
        break;
      case 'NotFoundError':
        reason = html10n.get('pad.ep_webrtc.error.notFound');
        this.sendErrorStat('NotFound');
        break;
      case 'NotReadableError':
        // `err.message` might give useful info to the user (not necessarily
        // useful for other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('pad.ep_webrtc.error.notReadable')))
            .append($('<p>').text(err.message));
        this.sendErrorStat('Hardware');
        break;
      case 'AbortError':
        // `err.message` might give useful info to the user (not necessarily useful for
        // other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('pad.ep_webrtc.error.otherCantAccess')))
            .append($('<p>').text(err.message));
        this.sendErrorStat('Abort');
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
  }

  async activate() {
    $('#options-enablertc').prop('checked', true);
    if (this._isActive) return;
    $('#rtcbox').css('display', 'flex');
    padcookie.setPref('rtcEnabled', true);
    this._isActive = true;
    const constraints = {
      audio: this._settings.audio.disabled !== 'hard',
      video: this._settings.video.disabled !== 'hard' && {width: {max: 320}, height: {max: 240}},
    };
    if (padcookie.getPref('fakeWebrtcFirefox')) {
      // The equivalent is done for chromium with cli option:
      // --use-fake-device-for-media-stream
      constraints.fake = true;
    }
    let stream = new MediaStream();
    if (constraints.audio || constraints.video) {
      try {
        stream = await window.navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        try {
          this.showUserMediaError(err);
        } finally {
          this.deactivate();
        }
        return;
      }
    }
    for (const track of stream.getAudioTracks()) {
      track.enabled = !!$('#options-audioenabledonstart').prop('checked');
    }
    for (const track of stream.getVideoTracks()) {
      track.enabled = !!$('#options-videoenabledonstart').prop('checked');
    }
    for (const track of stream.getTracks()) {
      this._localTracks.setTrack(track.kind, track);
    }
    this.setStream(this.getUserId(), this._localTracks.stream);
    this.hangupAll();
    this.invitePeer(null); // Broadcast an invite to everyone.
  }

  deactivate() {
    $('#options-enablertc').prop('checked', false);
    if (!this._isActive) return;
    $('#rtcbox').hide();
    padcookie.setPref('rtcEnabled', false);
    this.hangupAll();
    this.setStream(this.getUserId(), null);
    for (const track of this._localTracks.stream.getTracks()) {
      this._localTracks.setTrack(track.kind, null);
    }
    this._isActive = false;
  }

  toggleMuted() {
    return toggleTracks(this._localTracks.stream.getAudioTracks());
  }

  toggleVideo() {
    return toggleTracks(this._localTracks.stream.getVideoTracks());
  }

  getUserFromId(userId) {
    if (!this._pad || !this._pad.collabClient) return null;
    const result = this._pad.collabClient
        .getConnectedUsers()
        .filter((user) => user.userId === userId);
    const user = result.length > 0 ? result[0] : null;
    return user;
  }

  setStream(userId, stream) {
    let $video = $(`#${getVideoId(userId)}`);
    if (!stream) {
      $video.parent().remove();
      return;
    }
    const isLocal = userId === this.getUserId();
    if ($video.length === 0) $video = this.addInterface(userId, isLocal);
    if (isLocal) {
      // Sync the interface for the self view with the state of the outgoing stream.
      const $interface = $video.siblings('.interface-container');
      const hasAudio = stream.getAudioTracks().some((t) => t.enabled);
      if (this._settings.audio.disabled !== 'hard') {
        $interface.children('.audio-btn')
            .attr('title', hasAudio ? 'Mute' : 'Unmute')
            .toggleClass('muted', !hasAudio);
      } else if (hasAudio) {
        throw new Error('audio is hard disabled but local stream has audio');
      }
      const hasVideo = stream.getVideoTracks().some((t) => t.enabled);
      if (this._settings.video.disabled !== 'hard') {
        $interface.children('.video-btn')
            .attr('title', hasVideo ? 'Disable video' : 'Enable video')
            .toggleClass('off', !hasVideo);
      } else if (hasVideo) {
        throw new Error('video is hard disabled but local stream has video');
      }
    }
    // Avoid flicker by checking if .srcObject already equals stream.
    if ($video[0].srcObject !== stream) $video[0].srcObject = stream;
  }

  addInterface(userId, isLocal) {
    const videoId = getVideoId(userId);
    const size = `${this._settings.video.sizes.small}px`;
    const $video = $('<video>')
        .attr({
          id: videoId,
          playsinline: '',
          autoplay: '',
          muted: isLocal ? '' : null,
        })
        .prop('muted', isLocal) // Setting the 'muted' attribute isn't sufficient for some reason.
        .css({'width': size, 'max-height': size});
    const $interface = $('<div>')
        .addClass('interface-container')
        .attr('id', `interface_${videoId}`);
    const $videoContainer = $('<div>')
        .addClass('video-container')
        .toggleClass('local-user', isLocal)
        .css({'width': size, 'max-height': size})
        .append($('<div>').addClass('user-name'))
        .append($video)
        .append($interface);
    if (isLocal) $('#rtcbox').prepend($videoContainer);
    else $('#rtcbox').append($videoContainer);
    this.updatePeerNameAndColor(this.getUserFromId(userId));

    // /////
    // Mute button
    // /////

    const audioHardDisabled = isLocal && this._settings.audio.disabled === 'hard';
    $interface.append($('<span>')
        .addClass('interface-btn audio-btn buttonicon')
        .attr('title', audioHardDisabled ? 'Audio disallowed by admin' : 'Mute')
        .toggleClass('muted', audioHardDisabled)
        .toggleClass('disallowed', audioHardDisabled)
        .on(audioHardDisabled ? {} : {
          click: (event) => {
            const muted = isLocal ? this.toggleMuted() : ($video[0].muted = !$video[0].muted);
            $(event.currentTarget)
                .attr('title', muted ? 'Unmute' : 'Mute')
                .toggleClass('muted', muted);
          },
        }));

    // /////
    // Disable Video button
    // /////

    if (isLocal) {
      const videoHardDisabled = this._settings.video.disabled === 'hard';
      $interface.append($('<span>')
          .addClass('interface-btn video-btn buttonicon')
          .attr('title', videoHardDisabled ? 'Video disallowed by admin' : 'Disable video')
          .toggleClass('off', videoHardDisabled)
          .toggleClass('disallowed', videoHardDisabled)
          .on(videoHardDisabled ? {} : {
            click: (event) => {
              const videoEnabled = !this.toggleVideo();
              $(event.currentTarget)
                  .attr('title', videoEnabled ? 'Disable video' : 'Enable video')
                  .toggleClass('off', !videoEnabled);
            },
          }));
    }

    // /////
    // Enlarge Video button
    // /////

    let videoEnlarged = false;
    $interface.append($('<span>')
        .addClass('interface-btn enlarge-btn buttonicon')
        .attr('title', 'Make video larger')
        .on({
          click: (event) => {
            videoEnlarged = !videoEnlarged;
            $(event.currentTarget)
                .attr('title', videoEnlarged ? 'Make video smaller' : 'Make video larger')
                .toggleClass('large', videoEnlarged);
            const videoSize = `${this._settings.video.sizes[videoEnlarged ? 'large' : 'small']}px`;
            $video.parent().css({'width': videoSize, 'max-height': videoSize});
            $video.css({'width': videoSize, 'max-height': videoSize});
          },
        }));

    return $video;
  }

  // Sends a stat to the back end. `statName` must be in the
  // approved list on the server side.
  sendErrorStat(statName) {
    const msg = {
      component: 'pad',
      type: 'STATS',
      data: {statName, type: 'RTC_MESSAGE'},
    };
    this._pad.socket.json.send(msg);
  }

  sendMessage(to, data) {
    this._pad.collabClient.sendMessage({
      type: 'RTC_MESSAGE',
      payload: {data, to},
    });
  }

  hangupAll() {
    for (const userId of this._peers.keys()) this.hangup(userId);
    // Broadcast a hangup message to everyone, even to peers that we did not have a WebRTC
    // connection with. This prevents inconsistent state if the user disables WebRTC after an invite
    // is sent but before the remote peer initiates the connection.
    this.sendMessage(null, {hangup: 'hangup'});
  }

  getUserId() {
    return this._pad.getUserId();
  }

  hangup(userId) {
    this.setStream(userId, null);
    const peer = this._peers.get(userId);
    if (peer == null) return;
    peer.close();
    this._peers.delete(userId);
  }

  // See if the peer is interested in establishing a WebRTC connection. If the peer isn't interested
  // it will ignore the invite; if it is interested, it will either initiate a WebRTC connection (if
  // it has a track to stream) or it send back an invite of its own (if it doesn't have a track to
  // stream). If an uninterested peer later becomes interested, the peer will send an invite.
  //
  // DO NOT connect to the peer unless invited by the peer because an uninterested peer will discard
  // the WebRTC signaling messages. This is bad because WebRTC assumes reliable, in-order delivery
  // of signaling messages, so the discards will break future connection attempts.
  invitePeer(userId) {
    this.sendMessage(userId, {invite: 'invite'});
  }

  getPeerConnection(userId) {
    let peer = this._peers.get(userId);
    if (peer == null) {
      peer = new PeerState(
          {iceServers: this._settings.iceServers},
          (msg) => this.sendMessage(userId, msg),
          this._localTracks);
      this._peers.set(userId, peer);
      peer.addEventListener('stream', ({stream}) => {
        this.setStream(userId, stream);
      });
      peer.addEventListener('streamgone', ({stream}) => {
        this.setStream(userId, null);
      });
      peer.addEventListener('closed', () => {
        this.hangup(userId);
      });
    }
    return peer;
  }

  // Connect a setting to a checkbox. To be called on initialization.
  //
  // It will check for the value in urlVar, cookie, and the site-wide
  //   default value, in that order
  // If urlVar is found, it will also set the cookie
  // Finally, it sets up to set cookie if the user changes the setting in the gearbox
  settingToCheckbox(params) {
    for (const prop of ['checkboxId', 'cookie', 'defaultVal', 'urlVar']) {
      if (params[prop] == null) throw new Error(`missing ${prop} in settingToCheckbox`);
    }

    let value;
    const urlValue = (new URLSearchParams(window.location.search)).get(params.urlVar);

    // * If the setting is in the URL: use it, and also set the cookie
    // * If the setting is not in the URL: try to get it from the cookie
    // * If the setting was in neither, go with the site-wide default value
    //   but don't put it in the cookies
    if (['YES', 'true'].includes(urlValue)) { // 'YES' is for backward compatibility with av=YES.
      padcookie.setPref(params.cookie, true);
      value = true;
    } else if (['NO', 'false'].includes(urlValue)) { // 'NO' for symmetry with deprecated av=YES.
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
  }
}();

for (const hookFn of [
  'handleClientMessage_RTC_MESSAGE',
  'postAceInit',
  'userJoinOrUpdate',
  'userLeave',
]) {
  exports[hookFn] = exports.rtc[hookFn].bind(exports.rtc);
}

// Access to do some unit tests. If there's a more formal way to do this for all plugins,
// we can change to that.
window.ep_webrtc = exports.rtc;
