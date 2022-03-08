![Publish Status](https://github.com/ether/ep_webrtc/workflows/Node.js%20Package/badge.svg) ![Backend Tests Status](https://github.com/ether/ep_webrtc/workflows/Backend%20tests/badge.svg)

# ep_webrtc

WebRTC-based audio/video chat and screen sharing with other users visiting the
same pad.

The audio and video streams are peer-to-peer: every user sends a copy of their
audio/video streams directly to every other user visiting the same pad. Because
of this, it works well for small groups (2 to 4 users, more if video is disabled
or everyone has fast Internet connections) but not for large groups.

## Installation

* Option 1: Use the `/admin` interface, search for `ep_webrtc`, and click
  Install.
* Option 2:
  ```shell
  cd /path/to/etherpad
  npm install --no-save --legacy-peer-deps ep_webrtc
  ```
* Option 3:
  ```shell
  cd /path/to/etherpad/node_modules
  git clone https://github.com/ether/ep_webrtc
  ```

## Settings

### Plugin On/Off

In the settings menu there is a toggle to turn the plugin on and off for the
user. When toggled, its state is saved in a cookie and applied when any pad is
visited. The value can also be changed by adding `av=true` or `av=false` to the
URL query parameters.

The default value for this setting can be controlled in the server's
`settings.json` file (it defaults to `true`):

```json
  "ep_webrtc": {
    "enabled": true
  }
```

### Video/Audio On/Off

The settings menu also contains separate toggles for starting video and audio
sharing when the plugin is enabled. When toggled, their state is saved in a
cookie and applied when any pad is visited. They can also be changed by adding
the following to the URL query parameters:

* `webrtcaudioenabled=true`
* `webrtcaudioenabled=false`
* `webrtcvideoenabled=true`
* `webrtcvideoenabled=false`

The default value can be controlled in the server's `settings.json` file:

```json
  "ep_webrtc": {
    "audio": {
      "disabled": "none"
    },
    "video": {
      "disabled": "none"
    }
  }
```

Supported values for `"disabled"`:

* `"none"` (the default): Initially enabled by default.
* `"soft"`: Initially disabled by default.
* `"hard"`: Unavailable (it cannot be enabled).

### Custom Activate Button

The misnamed `listenClass` setting allows you to specify a CSS selector for an
element (or elements) that will activate the plugin when clicked. This is
usually combined with `"enabled": false`. Example:

```json
  "ep_webrtc": {
    "enabled": false,
    "listenClass": "#startVideoSessionButton"
  }
```

### ICE (STUN/TURN) Servers

By default, this plugin uses Google's STUN servers. To use custom STUN/TURN
servers, set `ep_webrtc.iceServers` in your `settings.json` to a list of
[RTCIceServer](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceServer)
objects:

```json
  "ep_webrtc": {
    "iceServers": [
      {"urls": ["stun:stun.l.google.com:19302"]}
    ]
  }
```

Include a TURN server to support users behind symmetric NAT devices. For
example:

```json
  "ep_webrtc": {
    "iceServers": [
      {
        "urls": ["stun:stun.l.google.com:19302"]
      },
      {
        "urls": ["turn:turn.example.com:3478"],
        "username": "the_username",
        "credential": "the_password"
      }
    ]
  }
```

#### Ephemeral credentials

To limit abuse, the [coturn](https://github.com/coturn/coturn) TURN server
supports [ephemeral (temporary) usernames and
passwords](https://github.com/coturn/coturn/blob/60e7a199fe748cb7080594a458d22c2f7bb15a8c/README.turnserver#L664-L729).
To take advantage of this feature, configure your TURN entry as follows:

* `credentialType`: Must be set to the exact string `"coturn ephemeral
  password"`.
* `username`: Ignored. (The username that will be sent to the TURN server is
  dynamically generated and based on the user's Etherpad-generated author ID.)
* `credential`: Must be set to coturn's [`static-auth-secret`
  setting](https://github.com/coturn/coturn/blob/60e7a199fe748cb7080594a458d22c2f7bb15a8c/README.turnserver#L445-L450).
* `lifetime`: How long (in seconds) the password will remain valid after the
  user visits a pad. After this amount of time, new TURN connections will fail
  until the user reloads the page (which will generate a new password). Defaults
  to 43200 (12 hours).

Example:

```json
  "ep_webrtc": {
    "iceServers": [
      {
        "urls": ["stun:stun.l.google.com:19302"]
      },
      {
        "urls": ["turn:coturn.example.com:3478"],
        "credentialType": "coturn ephemeral password",
        "credential": "your_coturn_secret",
        "lifetime": 3600
      }
    ]
  },
```

There is also support for ephemeral credentials from the
[Xirsys](https://xirsys.com/) [API](https://docs.xirsys.com/?pg=api-turn):

  * `credentialType` (required): Must be set to the exact string `"xirsys
    ephemeral credentials"`.
  * `url` (required): The desired Xirsys TURN API endpoint.
  * `username` (required): Your Xirsys username.
  * `credential` (required): Your Xirsys API secret.
  * `lifetime` (optional; defaults to 43200 = 12 hours): How long (in seconds)
    the ephemeral credentials will remain valid after the user visits a pad.
    After this amount of time, new TURN connections will fail until the user
    reloads the page (which will generate a new password).

Example:

```json
  "ep_webrtc": {
    "iceServers": [
      {
        "credentialType": "xirsys ephemeral credentials",
        "url": "https://global.xirsys.net/_turn/myChannel",
        "username": "myUsername",
        "credential": "myPassword",
        "lifetime": 3600
      }
    ]
  },
```

#### Horizontally scaled TURN servers

To spread load across multiple TURN services, you can enable sharding:

```json
  "ep_webrtc": {
    "iceServers": [
      {"urls": ["stun:shard0.example.com", "turn:shard0.example.com"]},
      {"urls": ["stun:shard1.example.com", "turn:shard1.example.com"]},
      {"urls": ["stun:shard2.example.com", "turn:shard2.example.com"]},
      {"urls": ["stun:shard3.example.com", "turn:shard3.example.com"]},
    ],
    "shardIceServers": true
  },
```

When `shardIceServers` is `false` (the default), all clients receive all
RTCIceServer objects in the `iceServers` list and it's up to the browser to
figure out how to use them to connect with peers. When `true`, this plugin
assigns a single entry from `iceServers` to each pad and gives out only that
assigned entry to users that connect to the pad. The intention is to provide a
better guarantee of load distribution across a set of TURN servers, and to avoid
an unnecessary network hop when both peers are configured to force the use of
TURN.

### Microphone Settings

The microphone can be configured by setting `audio.constraints` to any [audio
constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#parameters)
value acceptable to client browsers. It has the following default value:

```json
  "ep_webrtc": {
    "audio": {
      "constraints": {
        "autoGainControl": {"ideal": true},
        "echoCancellation": {"ideal": true},
        "noiseSuppression": {"ideal": true}
      }
    }
  },
```

For a full list of available constraints, see [the
standard](https://www.w3.org/TR/2022/CRD-mediacapture-streams-20220307/#constrainable-properties).

### Video Sizes

The camera's record resolution can be configured by setting `video.constraints`
to any [video
constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#parameters)
value acceptable to client browsers. It has the following default value:

```json
  "ep_webrtc": {
    "video": {
      "constraints": {
        "width": {"ideal": 160},
        "height": {"ideal": 120}
      }
    }
  },
```

For a full list of available constraints, see [the
standard](https://www.w3.org/TR/2022/CRD-mediacapture-streams-20220307/#constrainable-properties).

Changing the record resolution does not change the size of the displayed video
widgets. To change the video widget size, set `video.sizes.small` and/or
`video.sizes.large`:

```json
  "ep_webrtc": {
    "video": {
      "sizes": {
        "small": 200,
        "large": 400
      }
    }
  },
```

## Metrics

You can see metrics for various errors that users have when attempting to
connect their camera/microphone:

* `ep_webrtc_err_Hardware`: Some sort of hardware-related connection problem on
  the users' computer.
* `ep_webrtc_err_NotFound`: Could not find user's camera/microphone.
* `ep_webrtc_err_Abort`: Some sort of other, non-hardware related connection
  problem on the user's computer.
* `ep_webrtc_err_Permission`: User did not grant permission to their
  camera/microphone.
* `ep_webrtc_err_SecureConnection`: Etherpad is not set up on a secure
  connection, which is requried for WebRTC.
* `ep_webrtc_err_Unknown`: Some other unspecified error. Perhaps a bug in this
  plugin.

## Developing and contributing

### Basic

If you're just working on the interface and don't need to test connections to
other computers, you can point your browser to `localhost` instead of `0.0.0.0`.
WebRTC generally requires a secure connection (https), but [an exception is
made](https://w3c.github.io/webappsec-secure-contexts/#localhost) specifically
for localhost and domains that end in `.localhost`.

### Developing / Testing Communications

If you need to test communication, you may get away with opening two browser
windows to the same URL on `localhost`. However this may be of limited utility,
especially if you're confirming that sound works appropriately. In order to test
on two computers, you'll need your dev computer to serve on an IP address
accessible from the other computer, at which point you will no longer get away
with using `localhost`. You will need SSL certs, though for dev purposes they
can be self-signed.

[Generate your certificate](https://serverfault.com/a/224127), which will give
you your cert and key files. In `settings.js`, set the full path to them on your
file system:

```json
  "ssl": {
    "key": "/path-to-your/epl-server.key",
    "cert": "/path-to-your/epl-server.crt"
    // "ca" - not needed for dev purposes
  }
```

Point your browser to your outward facing IP address, preceeded by `https://`,
and accept the security warning (since this is a self-signed cert).

### Bug Reports

Please submit bug reports or patches at
https://github.com/ether/ep_webrtc/issues
