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

const enableDebugLogging = false;
const debug = (...args) => { if (enableDebugLogging) console.debug('ep_webrtc:', ...args); };

// Used to help remote peers detect when this user reloads the page.
const sessionId = `${Date.now()}_${Math.floor(Math.random() * (1 << 16)).toString(16)}`;

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
      debug(`removing ${kind} track ${oldTrack.id} from local stream`);
      this.stream.removeTrack(oldTrack);
      break;
    }
    if (newTrack != null) {
      debug(`adding ${kind} track ${newTrack.id} to local stream`);
      this.stream.addTrack(newTrack);
    }
    this.dispatchEvent(Object.assign(new CustomEvent('trackchanged'), {oldTrack, newTrack}));
    if (oldTrack != null) {
      debug(`stopping ${kind} track ${oldTrack.id}`);
      oldTrack.stop();
    }
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

// The WebRTC negotiation logic used here is based on the "Perfect Negotiation Example" at
// https://www.w3.org/TR/2021/REC-webrtc-20210126/#perfect-negotiation-example. See there for
// details about how it works.
//
// Events:
//   * 'stream' (see StreamEvent): Emitted when the remote stream is ready. For every 'stream' event
//     there will be a corresponding 'streamgone' event. Once a stream is added another stream will
//     not be added until after the original stream is removed.
//   * 'streamgone' (see StreamEvent): Emitted when the remote stream goes away, including when the
//     PeerState is closed.
//   * 'closed' (see ClosedEvent): Emitted when the PeerState is closed, except when closed by a
//     call to close(). The PeerState must not be used after it is closed.
class PeerState extends EventTarget {
  constructor(pcConfig, polite, sendMessage, localTracks, debug) {
    super();
    this._pcConfig = pcConfig;
    this._polite = polite;
    this._sendMessage = (msg) => sendMessage(Object.assign({ids: this._ids}, msg));
    this._localTracks = localTracks;
    this._debug = debug;
    this._debug(`I am the ${this._polite ? '' : 'im'}polite peer`);
    this._ids = {
      // Only changes when the user reloads the page.
      session: sessionId,
      // Counter that is increased when WebRTC renegotiation is necessary due to an error.
      instance: 0,
    };
    this._remoteIds = null;
    this._closed = false;
    this._pc = null;
    this._remoteStream = null;
    this._onremovetrack =
        () => { if (this._remoteStream.getTracks().length === 0) this._setRemoteStream(null); };

    this._resetConnection();

    this._ontrackchanged = async ({oldTrack, newTrack}) => {
      this._debug(`replacing ${oldTrack ? oldTrack.kind : newTrack.kind} track ` +
                  `${oldTrack ? oldTrack.id : '(null)'} with ` +
                  `${newTrack ? newTrack.id : '(null)'}`);
      if (oldTrack != null) {
        for (const sender of this._pc.getSenders()) {
          if (sender.track !== oldTrack) continue;
          if (newTrack != null) {
            try {
              return await sender.replaceTrack(newTrack);
            } catch (err) {
              this._debug('renegotiation is required');
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
    this._debug('creating RTCPeerConnection');
    this._setRemoteStream(null);
    this._remoteIds = {session: null, instance: null};
    // This negotiation state is captured in closures (instead of doing something like
    // this._negotiationState) because this._resetConnection() needs to be sure that all of the
    // event handlers for the old RTCPeerConnection do not mutate the negotiation state for the new
    // RTCPeerConnection.
    const negotiationState = {
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    };
    const pc = new RTCPeerConnection(this._pcConfig);
    pc.addEventListener('track', ({track, streams}) => {
      if (streams.length !== 1) throw new Error('Expected track to be in exactly one stream');
      this._setRemoteStream(streams[0]);
    });
    pc.addEventListener('icecandidate', ({candidate}) => this._sendMessage({candidate}));
    pc.addEventListener('negotiationneeded', async () => {
      try {
        negotiationState.makingOffer = true;
        await pc.setLocalDescription();
        this._sendMessage({description: pc.localDescription});
      } finally {
        negotiationState.makingOffer = false;
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      this._debug(`connection state changed to ${pc.connectionState}`);
      switch (pc.connectionState) {
        case 'closed': this.close(true); break;
        // From reading the spec it is not clear what the possible state transitions are, but it
        // seems that on at least Chrome 90 the 'failed' state is terminal (it can never go back to
        // working) so a new RTCPeerConnection must be made.
        case 'failed':
          this._ids.instance++; // Let the peer know that it must reset its state.
          this._resetConnection();
          break;
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this._debug(`ICE connection state changed to ${pc.iceConnectionState}`);
      switch (pc.iceConnectionState) {
        case 'closed': this.close(true); break;
        case 'failed': pc.restartIce(); break;
      }
    });

    if (this._pc != null) this._pc.close();
    this._pc = pc;
    this._setRemoteDescription = async (description) => {
      const readyForOffer = !negotiationState.makingOffer &&
          (pc.signalingState === 'stable' || negotiationState.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      negotiationState.ignoreOffer = !this._polite && offerCollision;
      if (negotiationState.ignoreOffer) return;
      negotiationState.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      // The "Perfect Negotiation Example" doesn't put this next line inside a `finally` block. It
      // is unclear whether that is intentional. Fortunately it doesn't matter here: If the above
      // pc.setRemoteDescription() call throws, _resetConnection() is called to restart the
      // negotiation anyway.
      negotiationState.isSettingRemoteAnswerPending = false;
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this._sendMessage({description: pc.localDescription});
      }
    };
    this._addIceCandidate = async (candidate) => {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!negotiationState.ignoreOffer) throw err;
      }
    };

    const tracks = this._localTracks.stream.getTracks();
    for (const track of tracks) {
      this._debug(`start streaming ${track.kind} track ${track.id}`);
      pc.addTrack(track, this._localTracks.stream);
    }
    // Creating an RTCPeerConnection doesn't actually generate any control messages until
    // RTCPeerConnection.addTrack() is called. It is possible that the last invite sent to the peer
    // was sent before the peer was ready to accept invites. If that is the case and there are no
    // local tracks to trigger a WebRTC message exchange, the peer won't know that it is OK to
    // connect back. Send another invite just in case. The peer will ignore any superfluous invites.
    if (tracks.length === 0) this._sendMessage({invite: 'invite'});
  }

  async receiveMessage({ids, candidate, description, hangup}) {
    if (this._closed) throw new Error('Unable to process message because PeerState is closed');
    if (hangup != null) {
      this.close(true);
      return;
    }
    if (ids != null) {
      for (const idType of ['session', 'instance']) {
        const newId = ids[idType];
        if (newId != null) {
          const oldId = this._remoteIds[idType];
          if (oldId != null && newId !== oldId) {
            // The remote peer reloaded the page or experienced an error. Destroy and recreate the
            // local RTCPeerConnection to avoid browser quirks caused by state mismatches.
            this._debug(`remote peer forced WebRTC renegotiation via new ${idType} ID ` +
                        `(old ID ${oldId}, new ID ${newId})`);
            this._resetConnection();
          }
          this._remoteIds[idType] = newId;
        }
      }
    }
    try {
      if (description != null) await this._setRemoteDescription(description);
      if (candidate != null) await this._addIceCandidate(candidate);
    } catch (err) {
      console.error('Error processing message from peer:', err);
      this._ids.instance++; // Let the peer know that it must reset its state.
      this._resetConnection();
      return;
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

const isPolite = (myId, otherId) => {
  // Compare user IDs to determine which of the two users is the "polite" user.
  const polite = myId.localeCompare(otherId) < 0;
  if ((otherId.localeCompare(myId) < 0) === polite) {
    // One peer must be polite and the other must be impolite.
    throw new Error(`Peer ID ${otherId} compares equivalent to own ID ${myId}`);
  }
  return polite;
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
    this._settings = clientVars.ep_webrtc;
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
    debug(`(peer ${userId}) join or update`);
    if (!this._isActive || !userId) return;
    if (userId !== this.getUserId()) this.invitePeer(userId);
    this.updatePeerNameAndColor(userInfo);
  }

  userLeave(hookName, {userInfo: {userId}}) {
    debug(`(peer ${userId}) leave`);
    this.hangup(userId);
  }

  handleClientMessage_RTC_MESSAGE(hookName, {payload: {from, data}}) {
    debug(`(peer ${from}) received message`, data);
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
    const $video = $(`#${getVideoId(userId)}`);
    $video.parent().css({'border-left-color': color});
    $video.siblings('.user-name').text(name);
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

  async updateLocalTracks() {
    const addAudioTrack = this._settings.audio.disabled !== 'hard';
    const addVideoTrack = this._settings.video.disabled !== 'hard';
    if (addAudioTrack || addVideoTrack) {
      debug(`requesting permission to access ${
        addAudioTrack && addVideoTrack ? 'camera and microphone'
        : addAudioTrack ? 'microphone'
        : 'camera'}`);
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: addAudioTrack,
        video: addVideoTrack && {width: {max: 320}, height: {max: 240}},
      });
      debug('successfully accessed device(s)');
      for (const track of stream.getTracks()) this._localTracks.setTrack(track.kind, track);
    }
    for (const track of this._localTracks.stream.getAudioTracks()) {
      track.enabled = !!$('#options-audioenabledonstart').prop('checked');
    }
    for (const track of this._localTracks.stream.getVideoTracks()) {
      track.enabled = !!$('#options-videoenabledonstart').prop('checked');
    }
  }

  async activate() {
    const $checkbox = $('#options-enablertc');
    $checkbox.prop('checked', true);
    if (this._isActive) return;
    debug('activating');
    $checkbox.prop('disabled', true);
    try {
      $('#rtcbox').css('display', 'flex');
      padcookie.setPref('rtcEnabled', true);
      this._isActive = true;
      try {
        await this.updateLocalTracks();
      } catch (err) {
        try {
          this.showUserMediaError(err);
        } finally {
          this.deactivate();
        }
        return;
      }
      this.hangupAll();
      this.invitePeer(null); // Broadcast an invite to everyone.
      await this.setStream(this.getUserId(), this._localTracks.stream);
    } finally {
      $checkbox.prop('disabled', false);
    }
  }

  deactivate() {
    const $checkbox = $('#options-enablertc');
    $checkbox.prop('checked', false);
    if (!this._isActive) return;
    debug('deactivating');
    $checkbox.prop('disabled', true);
    try {
      padcookie.setPref('rtcEnabled', false);
      this.hangupAll();
      this.setStream(this.getUserId(), null);
      const $rtcbox = $('#rtcbox');
      $rtcbox.empty(); // In case any peer videos didn't get cleaned up for some reason.
      $rtcbox.hide();
      for (const track of this._localTracks.stream.getTracks()) {
        this._localTracks.setTrack(track.kind, null);
      }
      this._isActive = false;
    } finally {
      $checkbox.prop('disabled', false);
    }
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

  async setStream(userId, stream) {
    let $video = $(`#${getVideoId(userId)}`);
    if (!stream) {
      $video.parent().remove();
      return;
    }
    const isLocal = userId === this.getUserId();
    if ($video.length === 0) $video = this.addInterface(userId, isLocal);
    if (isLocal) {
      // Sync the interface for the self view with the state of the outgoing stream.
      const $interface = $(`#interface_${getVideoId(userId)}`);
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
    await this.playVideo($video);
  }

  async playVideo($video) {
    if (!$video[0].paused) return;
    // play() will block indefinitely if there are no enabled tracks.
    if (!$video[0].srcObject.getTracks().some((t) => t.enabled)) return;
    try {
      return await $video[0].play();
    } catch (err) {
      // AbortError can happen if there is a hangup (e.g., the user disables WebRTC) while playback
      // is starting. The video element will be deleted shortly (if it hasn't already been deleted)
      // so it's OK to ignore the error.
      if (err.name === 'AbortError') return;
      // Browsers won't allow autoplayed video with sound until the user has interacted with the
      // page or the page is already capturing audio or video. If playback is not permitted, mute
      // the video and try again.
      if (err.name === 'NotAllowedError' && !$video[0].muted) {
        // The self view is always muted, so this click() only applies to videos of remote peers.
        $(`#interface_${$video.attr('id')} .audio-btn`).click();
        $video.data('automuted', true);
        return await this.playVideo($video);
      }
      throw err;
    }
  }

  // Tries to unmute and play any videos that were auto-muted (perhaps the browser prohibited
  // autoplay). If unmuting a video fails (perhaps the browser still thinks we're trying to
  // autoplay), the video is auto-muted again.
  async unmuteAutoMuted() {
    await Promise.all($('#rtcbox video').map(async (i, video) => {
      const $video = $(video);
      if (!$video.data('automuted')) return;
      $(`#interface_${$video.attr('id')} .audio-btn`).click();
      await this.playVideo($video);
    }).get());
  }

  addInterface(userId, isLocal) {
    debug(isLocal ? 'adding self-view interface' : `(peer ${userId}) adding interface`);
    const videoId = getVideoId(userId);
    const size = `${this._settings.video.sizes.small}px`;
    const $video = $('<video>')
        .attr({
          id: videoId,
          // `playsinline` seems to be required on iOS (both Chrome and Safari), but not on any
          // other platform. `autoplay` might also be needed on iOS, or maybe it's superfluous (it
          // doesn't hurt to add it).
          playsinline: '',
          autoplay: '',
          muted: isLocal ? '' : null,
        })
        .prop('muted', isLocal); // Setting the 'muted' attribute isn't sufficient for some reason.
    const $interface = $('<div>')
        .addClass('interface-container')
        .attr('id', `interface_${videoId}`);
    $('#rtcbox').append($('<div>')
        .addClass('video-container')
        .toggleClass('local-user', isLocal)
        .css({width: size})
        .append($('<div>').addClass('user-name'))
        .append($video)
        .append($interface));
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
            $video.removeData('automuted');
            // Do not use `await` when calling unmuteAutoMuted() because unmuting is best-effort
            // (success of this handler does not depend on the ability to unmute). Call
            // unmuteAutoMuted() early so that the browser can work on unmuting the video in
            // parallel with the rest of this handler.
            this.unmuteAutoMuted();
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
              // Don't use `await` here -- see the comment for the audio button click handler above.
              this.unmuteAutoMuted();
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
            // Don't use `await` here -- see the comment for the audio button click handler above.
            this.unmuteAutoMuted();
            videoEnlarged = !videoEnlarged;
            $(event.currentTarget)
                .attr('title', videoEnlarged ? 'Make video smaller' : 'Make video larger')
                .toggleClass('large', videoEnlarged);
            const videoSize = `${this._settings.video.sizes[videoEnlarged ? 'large' : 'small']}px`;
            $video.parent().css({width: videoSize});
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
    debug(`(${to == null ? 'to everyone on the pad' : `peer ${to}`}) sending message`, data);
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
    debug(`(peer ${userId}) hangup`);
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
    this.sendMessage(userId, {ids: {session: sessionId}, invite: 'invite'});
  }

  getPeerConnection(userId) {
    let peer = this._peers.get(userId);
    if (peer == null) {
      const _debug = (...args) => debug(`(peer ${userId})`, ...args);
      _debug('creating PeerState');
      peer = new PeerState(
          {iceServers: this._settings.iceServers},
          isPolite(this.getUserId(), userId),
          (msg) => this.sendMessage(userId, msg),
          this._localTracks,
          _debug);
      this._peers.set(userId, peer);
      peer.addEventListener('stream', async ({stream}) => {
        _debug(`remote stream ${stream.id} added`);
        await this.setStream(userId, stream);
      });
      peer.addEventListener('streamgone', async ({stream}) => {
        _debug(`remote stream ${stream.id} removed`);
        await this.setStream(userId, null);
      });
      peer.addEventListener('closed', () => {
        _debug('PeerState closed');
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
