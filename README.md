ep_webrtc
=========

[![Travis (.org)](https://img.shields.io/travis/ether/ep_webrtc)](https://travis-ci.org/github/ether/ep_webrtc)

WebRTC based audio/video chat for your documents.
This plugin creates an audio/video chat with all
active users of the pad using WebRTC.

# Installing

Option 1.

Use the ``/admin`` interface, search for ``ep_webrtc`` and click Install

Option 2.
```
cd your_etherpad_install
npm install ep_webrtc
```
Option 3.
```
cd your_etherpad_install/node_modules
git clone https://github.com/ether/ep_webrtc
```

## Post installation

You should use a STUN/TURN server to ensure consistant connecivty between clients.  See STUN/TURN in settings.

# Settings

## Enabling or disabling the feature

### Per-User

There's a setting for each user under their settings menu that can turn audio/video chat feature off and on. The setting is saved in cookies and will apply when they reload the page. The user can also change the value of this setting to true by loading the page with `?av=YES` in the URL path. (at the moment, `av=NO` does not work to turn it off)

### Site-Wide

There is a site-wide setting in `settings.json` that determines whether the feature is initially turned on or off for users who have not yet set their own preference:

    "ep_webrtc" : {
        "enabled" : ...
    }

The `"enabled"` setting can either be `true` or `false`. It is optional, with a default value of `true`.

## Enabling or disabling audio or video individually

The audio/video chat feature gives the user the ability to temporarily disable ("mute") audio, and similarly temporarily disable video. A site admin may also choose to make audio or video entirely unavailable to users.

### Per-User

Each user has the ability, using a setting under the settings menu, to set whether video or audio are initially disabled when the page is loaded. The user can also change the value of these settings by loading the page with the appropriate parameters in the URL path:

* `?webrtcaudioenabled=true`
* `?webrtcaudioenabled=false`
* `?webrtcvideoenabled=true`
* `?webrtcvideoenabled=false`

### Site-Wide

There are site-wide settings in `settings.json` that determine whether audio or video are available to users, and whether they are initially turned on or off for users who have not yet set their own preference:

    "ep_webrtc" : {
        "audio" : {
            "disabled": ...
        }
        "video" : {
            "disabled": ...
        }
    }

The `"disabled"` setting under both `"audio"` and `"video"` can have one of the following values:

* `"none"` - available and initially turned on for users who haven't set their own preference
* `"soft"` - available but initially turned off for users who haven't set their own preference
* `"hard"` - unavailable to users

The setting is optional, with a default value of `"none"`.

## Other Interface

To set an element or class to listen for an init event set `ep_webrtc.listenClass` in your settings.json.  This is often stabled with ``"enabled":false`` and a button to provide a button to begin video sessions

    "ep_webrtc" : {
        "listenClass": "#chatLabel"
    }

## ICE Servers

To set a custom stun server, set `ep_webrtc.iceServer` in your settings.json:

    "ep_webrtc" : {
        "iceServers":[
            {"url": "stun:stun.l.google.com:19302"}
        ]
    }

To ensure reliable connectivity we recommend setting both a STUN and TURN server.  We don't set this by default and below are just example servers, you should ensure you use reliable STUN and TURN servers.


    "ep_webrtc" : {
      "iceServers":[
        {
          "urls": [ "stun:216.246.6.224:3478", "stun:74.125.140.127:19302", "stun:[2a00:1450:400c:c08::7f]:19302" ]
        }
          ,
        {
          "urls": [ "turn:numb.viagenie.ca" ],
          "credential": "muazkh",
          "username": "webrtc@live.com"
        },
        {
          "urls": ["turn:192.158.29.39:3478?transport=udp"],
          "credential": "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
          "username": "28224511:1379330808"
        }

        ],
    }

To set a custom small and/or large size in pixels, for the video displays, set one or both of the following in your settings.json:

    "ep_webrtc": {
      "video": {
        "sizes": {
          "small": 200,
          "large": 400
        }
      }
    }


## Metrics

You can see metrics for various errors that users have when attempting to connect their camera/microphone:

* `ep_webrtc_err_Hardware`: Some sort of hardware-related connection problem on the users' computer.
* `ep_webrtc_err_NotFound`: Could not find user's camera/microphone.
* `ep_webrtc_err_Abort`: Some sort of other, non-hardware related connection problem on the user's computer.
* `ep_webrtc_err_NotSupported`: User's environment does not support webrtc.
* `ep_webrtc_err_Permission`: User did not grant permission to their camera/microphone
* `ep_webrtc_err_SecureConnection`: Etherpad is not set up on a secure connection, which is requried for webrtc
* `ep_webrtc_err_Unknown`: Some other unspecified error. Perhaps a bug in this plugin.

# Developing and contributing

## Basic

If you're just working on the interface and don't need to test connections to other computers, you can point your browser to `localhost` instead of `0.0.0.0`. Webrtc generally requires a secure connection (https), but [an exception is made](https://w3c.github.io/webappsec-secure-contexts/#localhost) specifically for localhost and domains that end in `.localhost`.

## Developing / Testing Communications

If you need to test communication, you may get away with opening two browser windows to the same URL on `localhost`. However this may be of limited utility, especially if you're confirming that sound works appropriately. In order to test on two computers, you'll need your dev computer to serve on an IP address accessible from the other computer, at which point you will no longer get away with using `localhost`. You will need SSL certs, though for dev purposes they can be self-signed.

[Generate your certificate](https://serverfault.com/a/224127), which will give you your cert and key files. In `settings.js`, set the full path to them on your file system:

    "ssl" : {
      "key"  : "/path-to-your/epl-server.key",
      "cert" : "/path-to-your/epl-server.crt"
      // "ca" - not needed for dev purposes
    }

Point your browser to your outward facing IP address, preceeded by `https://`, and accept the security warning (since this is a self-signed cert).

## Bug Reports

Please submit bug reports or patches at https://github.com/ether/ep_webrtc/issues
