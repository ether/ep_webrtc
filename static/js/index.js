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
const sessionId = Date.now();
// Incremented each time a new RTCPeerConnection is created.
let nextInstanceId = 0;

class Mutex {
  async lock() {
    while (this._locked != null) await this._locked;
    this._locked = new Promise((resolve) => this._unlock = resolve);
  }

  unlock() {
    this._unlock();
    this._locked = null;
  }
}

class LocalTracks extends EventTarget {
  constructor() {
    super();
    Object.defineProperty(this, 'stream', {value: new MediaStream(), writeable: false});
  }

  _getTracks(kind) {
    return kind === 'audio' ? this.stream.getAudioTracks()
      : kind === 'video' ? this.stream.getVideoTracks()
      : this.stream.getTracks();
  }

  setTrack(kind, newTrack) {
    newTrack = newTrack || null; // Convert undefined to null.
    let oldTrack = null;
    const tracks = this._getTracks(kind);
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
      newTrack.addEventListener('ended', () => {
        debug(`local ${kind} track ${newTrack.id} ended`);
        if (!this._getTracks(kind).includes(newTrack)) return;
        this.setTrack(kind, null);
      });
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
      from: {
        // Only changes when the user reloads the page.
        session: sessionId,
        // Increased when WebRTC renegotiation is necessary due to an error.
        instance: 0,
      },
    };
    this._closed = false;
    this._pc = null;
    this._remoteStream = null;
    this._onremovetrack =
        () => { if (this._remoteStream.getTracks().length === 0) this._setRemoteStream(null); };
    this._ontrackchanged = async ({oldTrack, newTrack}) => {
      if (this._pc == null) return;
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
    if (stream === this._remoteStream) return;
    if (this._remoteStream != null) {
      const oldStream = this._remoteStream;
      oldStream.removeEventListener('removetrack', this._onremovetrack);
      this._remoteStream = null;
      this.dispatchEvent(new StreamEvent('streamgone', oldStream));
    }
    if (stream != null) {
      this._remoteStream = stream;
      stream.addEventListener('removetrack', this._onremovetrack);
      this.dispatchEvent(new StreamEvent('stream', stream));
    }
  }

  _resetConnection(peerIds = null) {
    this._debug('creating RTCPeerConnection');
    this._setRemoteStream(null);
    this._ids.from.instance = ++nextInstanceId;
    this._ids.to = peerIds;
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
        case 'connected':
          if (this._remoteStream == null) this._setRemoteStream(this._disconnectedRemoteStream);
          break;
        case 'disconnected':
          // Unfortunately, if the peer reconnects later there might not be a track event that can
          // be used to re-add the stream. Stash the stream so that it can be reused on reconnect.
          this._disconnectedRemoteStream = this._remoteStream;
          this._setRemoteStream(null);
          break;
        // From reading the spec it is not clear what the possible state transitions are, but it
        // seems that on at least Chrome 90 the 'failed' state is terminal (it can never go back to
        // working) so a new RTCPeerConnection must be made.
        case 'failed':
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
    // RTCPeerConnection.peerIdentity is mentioned in https://www.w3.org/TR/webrtc-identity/ but as
    // of 2021-06-24 only Firefox supports it.
    if (pc.peerIdentity != null) {
      // Silence "InvalidStateError: RTCPeerConnection is gone (did you enter Offline mode?)"
      // unhandled Promise rejection errors in Firefox. This can happen if Firefox drops the
      // connection because the pad is in an idle/background tab.
      pc.peerIdentity.catch((err) => this._debug('Failed to assert peer identity:', err));
    }

    if (this._pc != null) this._pc.close();
    this._pc = pc;
    this._setRemoteDescription = async (description) => {
      const readyForOffer = !negotiationState.makingOffer &&
          (pc.signalingState === 'stable' || negotiationState.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      negotiationState.ignoreOffer = !this._polite && offerCollision;
      if (negotiationState.ignoreOffer) {
        this._debug('ignoring offer due to offer collision');
        return;
      }
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
      const {
        session: wantSession = this._ids.from.session,
        instance: wantInstance = this._ids.from.instance,
      } = ids.to || {};
      if (wantSession !== this._ids.from.session || wantInstance !== this._ids.from.instance) {
        this._debug('dropping message intended for a different instance');
        this._debug('current IDs:', this._ids.from);
        return;
      }
      for (const idType of ['session', 'instance']) {
        const newId = ids.from[idType];
        const currentId = (this._ids.to || {})[idType];
        if (currentId == null || newId === currentId) continue;
        if (newId == null || newId < currentId) return;
        // The remote peer reloaded the page or experienced an error. Destroy and recreate the local
        // RTCPeerConnection to avoid browser quirks caused by state mismatches.
        this._debug(`remote peer forced WebRTC renegotiation via new ${idType} ID ` +
                    `(old ID ${currentId}, new ID ${newId})`);
        this._resetConnection(ids.from);
        break;
      }
      this._ids.to = ids.from;
    }
    if (this._pc == null) this._resetConnection(this._ids.to);
    try {
      if (description != null) await this._setRemoteDescription(description);
      if (candidate != null) await this._addIceCandidate(candidate);
    } catch (err) {
      console.error('Error processing message from peer:', err);
      this._resetConnection();
      return;
    }
  }

  close(emitClosedEvent = false) {
    if (this._closed) return;
    this._closed = true;
    this._localTracks.removeEventListener('trackchanged', this._ontrackchanged);
    if (this._pc != null) this._pc.close();
    this._pc = null;
    this._setRemoteStream(null);
    this._sendMessage({hangup: 'hangup'});
    if (emitClosedEvent) this.dispatchEvent(new ClosedEvent());
  }
}

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
    this._activated = null;
    this._settings = null;
    this._disabledSilence = (() => {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      const dst = gain.connect(ctx.createMediaStreamDestination());
      const track = dst.stream.getAudioTracks()[0];
      track.enabled = false;
      return track;
    })();
    this._localTracks = new LocalTracks();
    this._localTracks.addEventListener('trackchanged', ({oldTrack, newTrack}) => {
      if (newTrack != null) return;
      // Normally the self-view UI only needs to be updated if the user clicks on something, but it
      // also needs to be updated if the browser decides to end the local stream for whatever
      // reason. (Safari v14.1 on macOS v11.3.1 (Big Sur) seems to have a bug that causes it to
      // unexpectedly end local streams.)
      switch (oldTrack.kind) {
        case 'audio': this._selfViewButtons.audio.enabled = false; break;
        case 'video': this._selfViewButtons.video.enabled = false; break;
      }
    });
    this._localTracks.setTrack(this._disabledSilence.kind, this._disabledSilence);
    this._pad = null;
    this._peers = new Map();
    // Populated with convenience methods once the self-view interface is created.
    this._selfViewButtons = {};
    // When grabbing both locks the audio lock must be grabbed first to avoid deadlock.
    this._trackLocks = {audio: new Mutex(), video: new Mutex()};
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
        await this.deactivate();
      }
    });
    $(window).on('beforeunload', () => { this.hangupAll(); });
    $(window).on('unload', () => { this.hangupAll(); });
    if ($('#options-enablertc').prop('checked')) {
      await this.activate();
    } else {
      await this.deactivate();
    }
    $('#rtcbox').data('initialized', true); // Help tests determine when initialization is done.
  }

  userJoinOrUpdate(hookName, {userInfo}) {
    const {userId} = userInfo;
    debug(`(peer ${userId}) join or update`);
    if (!this._activated || !userId) return;
    if (userId !== this.getUserId()) this.invitePeer(userId);
    this.updatePeerNameAndColor(userInfo);
  }

  userLeave(hookName, {userInfo: {userId}}) {
    debug(`(peer ${userId}) leave`);
    this.hangup(userId);
  }

  handleClientMessage_RTC_MESSAGE(hookName, {payload: {from, data}}) {
    debug(`(peer ${from}) received message`, data);
    if (this._activated && from !== this.getUserId() &&
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
          reason = html10n.get('ep_webrtc_error_permission');
          this.sendErrorStat('Permission');
        } else {
          reason = html10n.get('ep_webrtc_error_ssl');
          this.sendErrorStat('SecureConnection');
        }
        break;
      case 'OverconstrainedError':
        debug(err);
        // Safari v14.1 on macOS v11.13.1 (Big Sur) on Sauce Labs emits OverconstrainedError when it
        // can't find a camera. Fall through to the NotFoundError case:
      case 'NotFoundError':
        reason = html10n.get('ep_webrtc_error_notFound');
        this.sendErrorStat('NotFound');
        break;
      case 'NotReadableError':
        // `err.message` might give useful info to the user (not necessarily
        // useful for other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('ep_webrtc_error_notReadable')))
            .append($('<p>').text(err.message));
        this.sendErrorStat('Hardware');
        break;
      case 'AbortError':
        // `err.message` might give useful info to the user (not necessarily useful for
        // other error messages)
        reason = $('<div>')
            .append($('<p>').text(html10n.get('ep_webrtc_error_otherCantAccess')))
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

  // Performs the following steps for the local audio and/or video tracks:
  //   1. Read the state of the UI: Is the button in the enabled or disabled state?
  //   2. Try to make the track match the state of the UI.
  //   3. Update the state of the UI to reflect the actual state. For example, if the user set the
  //      audio button to enabled but we failed to get permission to access the microphone, then the
  //      button is changed back to disabled.
  async updateLocalTracks({updateAudio, updateVideo}) {
    // Prevent overlapping requests to access the microphone/camera. (If getUserMedia() is called
    // concurrently the browser might return different track objects from each call.)
    if (updateAudio) await this._trackLocks.audio.lock();
    if (updateVideo) await this._trackLocks.video.lock();
    try {
      const addAudioTrack = updateAudio && this._selfViewButtons.audio.enabled &&
          !this._localTracks.stream.getAudioTracks().some(
              (t) => t !== this._disabledSilence && t.readyState === 'live');
      const addVideoTrack = updateVideo && this._selfViewButtons.video.enabled &&
          !this._localTracks.stream.getVideoTracks().some((t) => t.readyState === 'live');
      if (addAudioTrack || addVideoTrack) {
        debug(`requesting permission to access ${
          addAudioTrack && addVideoTrack ? 'camera and microphone'
          : addAudioTrack ? 'microphone'
          : 'camera'}`);
        let stream;
        try {
          stream = await window.navigator.mediaDevices.getUserMedia({
            audio: addAudioTrack,
            video: addVideoTrack && {width: {max: 320}, height: {max: 240}},
          });
          debug('successfully accessed device(s)');
        } catch (err) {
          // Display but otherwise ignore the error. The button(s) will be toggled back to
          // disabled below if we failed to access the microphone/camera. The user can re-click
          // the button to try again.
          (async () => this.showUserMediaError(err))();
          stream = new MediaStream();
        }
        for (const track of stream.getTracks()) this._localTracks.setTrack(track.kind, track);
      }
      if (updateAudio) {
        for (const track of this._localTracks.stream.getAudioTracks()) {
          // Re-check the state of the button because the user might have clicked it while
          // getUserMedia() was running.
          track.enabled = track !== this._disabledSilence && this._selfViewButtons.audio.enabled;
        }
        const hasAudio = this._localTracks.stream.getAudioTracks().some(
            (t) => t.enabled && t.readyState === 'live');
        this._selfViewButtons.audio.enabled = hasAudio;
      }
      if (updateVideo) {
        for (const track of this._localTracks.stream.getVideoTracks()) {
          // Re-check the state of the button because the user might have clicked it while
          // getUserMedia() was running.
          track.enabled = this._selfViewButtons.video.enabled;
        }
        const hasVideo = this._localTracks.stream.getVideoTracks().some(
            (t) => t.enabled && t.readyState === 'live');
        this._selfViewButtons.video.enabled = hasVideo;
      }
    } finally {
      if (updateVideo) this._trackLocks.video.unlock();
      if (updateAudio) this._trackLocks.audio.unlock();
    }
    await this.playVideo($(`#${getVideoId(this.getUserId())}`));
  }

  async activate() {
    if (!this._activated) {
      this._activated = (async () => {
        const $checkbox = $('#options-enablertc');
        $checkbox.prop('checked', true);
        debug('activating');
        $checkbox.prop('disabled', true);
        try {
          $('#rtcbox').css('display', 'flex');
          padcookie.setPref('rtcEnabled', true);
          this.hangupAll();
          this.invitePeer(null); // Broadcast an invite to everyone.
          await this.setStream(this.getUserId(), this._localTracks.stream);
          await this.updateLocalTracks({
            updateAudio: this._settings.audio.disabled !== 'hard',
            updateVideo: this._settings.video.disabled !== 'hard',
          });
        } finally {
          $checkbox.prop('disabled', false);
        }
        debug('activated');
      })();
    }
    await this._activated;
  }

  async deactivate(awaitActivated = true) {
    const $checkbox = $('#options-enablertc');
    $checkbox.prop('checked', false);
    if (awaitActivated) await this._activated;
    // Check this._activated after awaiting in case deactivate() is called multiple times while
    // activate() is running. (It's OK to await a null value.)
    if (!this._activated) return;
    debug('deactivating');
    $checkbox.prop('disabled', true);
    try {
      this._activated = null;
      padcookie.setPref('rtcEnabled', false);
      this.hangupAll();
      this.setStream(this.getUserId(), null);
      const $rtcbox = $('#rtcbox');
      $rtcbox.empty(); // In case any peer videos didn't get cleaned up for some reason.
      $rtcbox.hide();
      for (const track of this._localTracks.stream.getTracks()) {
        this._localTracks.setTrack(track.kind, null);
      }
    } finally {
      $checkbox.prop('disabled', false);
    }
    debug('deactivated');
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
    // Avoid flicker by checking if .srcObject already equals stream.
    if ($video[0].srcObject !== stream) $video[0].srcObject = stream;
    await this.playVideo($video);
  }

  async playVideo($video) {
    if (!$video[0].paused) return;
    // play() will block indefinitely if there are no enabled tracks.
    if (!$video[0].srcObject.getTracks().some((t) => t.enabled)) return;
    debug('playing video', $video[0]);
    try {
      return await $video[0].play();
    } catch (err) {
      debug('failed to play video', $video[0], err);
      // Browsers won't allow autoplayed video with sound until the user has interacted with the
      // page or the page is already capturing audio or video. If playback is not permitted, mute
      // the video and try again.
      if (err.name === 'NotAllowedError' && !$video[0].muted) {
        debug('auto-muting video', $video[0]);
        // The self view is always muted, so this click() only applies to videos of remote peers.
        $(`#interface_${$video.attr('id')} .audio-btn`).click();
        // Prevent infinite recursion if clicking the audio button didn't mute.
        if (!$video[0].muted) throw new Error('assertion failed: video element should be muted');
        $video.data('automuted', true);
        return await this.playVideo($video);
      }
      // The error is most likely a browser autoplay restriction. It's not useful to display such
      // errors -- or really any other play error for that matter -- in a gritter box, so ignore the
      // error. The video won't be playing, but that's not a big deal: The user can click on one of
      // the interface buttons to try playing again (via unmuteAndPlayAll()).
      //
      // TODO: Indicate the error in the video element (e.g., red circle with an exclamation point
      // that displays the error message when clicked or hovered over).
    }
  }

  // Tries to play any videos that aren't playing (including the self-view), or unmute videos that
  // are playing but were auto-muted (perhaps the browser prohibited autoplay). If playing or
  // unmuting a video fails (perhaps the browser still thinks we're trying to autoplay), the video
  // is auto-muted again.
  async unmuteAndPlayAll() {
    if (this._unmuteAndPlayAllInProgress) return; // Prevent infinite recursion if unmuting fails.
    this._unmuteAndPlayAllInProgress = true;
    try {
      await Promise.all($('#rtcbox video').map(async (i, video) => {
        const $video = $(video);
        if ($video.data('automuted')) $(`#interface_${$video.attr('id')} .audio-btn`).click();
        await this.playVideo($video);
      }).get());
    } finally {
      this._unmuteAndPlayAllInProgress = false;
    }
  }

  addInterface(userId, isLocal) {
    const _debug =
        (...args) => debug(`(${isLocal ? 'self-view' : `peer ${userId}`} interface)`, ...args);
    _debug('adding interface');
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

    // For tests it is important to know when an asynchronous event handler has finishing handling
    // an event. This function wraps async event handler functions so that tests can wait for all
    // executions of an event handler to finish by calling `await $element.data('idle')(eventName)`.
    const addAsyncEventHandlers = ($element, asyncHandlers) => {
      const busy = {};
      const handlers = {};
      for (const [event, handler] of Object.entries(asyncHandlers)) {
        handlers[event] = (...args) => {
          const p = Promise.resolve(handler(...args));
          const busyp = busy[event] = p
              .catch(() => {}) // Exceptions should not interrupt the Promise chain.
              .then(Promise.resolve(busy[event]))
              .then(() => { if (busy[event] === busyp) delete busy[event]; });
          // Add a no-op .then() function to force an unhandled promise rejection if p rejects.
          p.then(() => {});
        };
      }
      $element.on(handlers);
      $element.data('idle', async (event) => { while (busy[event] != null) await busy[event]; });
    };

    // /////
    // Mute button
    // /////

    const $audioBtn =
        $('<span>').addClass('interface-btn audio-btn buttonicon').appendTo($interface);
    const audioInterface = {
      get enabled() { return !$audioBtn.hasClass('muted'); },
      set enabled(val) {
        $audioBtn
            .toggleClass('muted', !val)
            .attr('title', val ? 'Mute' : 'Unmute');
      },
    };
    if (isLocal) this._selfViewButtons.audio = audioInterface;
    const audioHardDisabled = isLocal && this._settings.audio.disabled === 'hard';
    // Remote views are never muted even if the peer is currently not sending any audio (the peer
    // could start sending audio at any moment). Exception: If the browser blocks autoplay, we
    // automatically mute the remote view by simulating a click on the mute button.
    audioInterface.enabled =
        !isLocal || (!audioHardDisabled && $('#options-audioenabledonstart').prop('checked'));
    if (audioHardDisabled) {
      $audioBtn.attr('title', 'Audio disallowed by admin').addClass('disallowed');
    }
    addAsyncEventHandlers($audioBtn, audioHardDisabled ? {} : {
      click: async () => {
        $video.removeData('automuted');
        const muted = audioInterface.enabled;
        _debug(`audio button clicked to ${muted ? 'dis' : 'en'}able audio`);
        audioInterface.enabled = !muted;
        if (isLocal) await this.updateLocalTracks({updateAudio: true});
        else $video[0].muted = muted;
        // Do not use `await` when calling unmuteAndPlayAll() because unmuting is best-effort
        // (success of this handler does not depend on the ability to unmute, and this handler's
        // idle/busy status should not be affected by unmuteAndPlayAll()). Call unmuteAndPlayAll()
        // late so that it can call $video[0].play() after $video[0].muted is set to its new value,
        // and so that it can auto-mute if necessary.
        this.unmuteAndPlayAll();
      },
    });

    // /////
    // Disable Video button
    // /////

    if (isLocal) {
      const $videoBtn =
          $('<span>').addClass('interface-btn video-btn buttonicon').appendTo($interface);
      this._selfViewButtons.video = {
        get enabled() { return !$videoBtn.hasClass('off'); },
        set enabled(val) {
          $videoBtn
              .toggleClass('off', !val)
              .attr('title', val ? 'Disable video' : 'Enable video');
        },
      };
      const videoHardDisabled = this._settings.video.disabled === 'hard';
      this._selfViewButtons.video.enabled =
          !videoHardDisabled && $('#options-videoenabledonstart').prop('checked');
      if (videoHardDisabled) {
        $videoBtn.attr('title', 'Video disallowed by admin').addClass('disallowed');
      }
      addAsyncEventHandlers($videoBtn, videoHardDisabled ? {} : {
        click: async () => {
          const videoEnabled = !this._selfViewButtons.video.enabled;
          _debug(`video button clicked to ${videoEnabled ? 'en' : 'dis'}able video`);
          this._selfViewButtons.video.enabled = videoEnabled;
          await this.updateLocalTracks({updateVideo: true});
          // Don't use `await` here -- see the comment for the audio button click handler above.
          this.unmuteAndPlayAll();
        },
      });
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
            $video.parent().css({width: videoSize});
            // Don't use `await` here -- see the comment for the audio button click handler above.
            this.unmuteAndPlayAll();
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
    this.sendMessage(userId, {ids: {from: {session: sessionId}}, invite: 'invite'});
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
