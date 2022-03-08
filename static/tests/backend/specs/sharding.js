'use strict';

const assert = require('assert').strict;
const common = require('ep_etherpad-lite/tests/backend/common');
const init = require('../init');
const plugin = require('../../../../index');
const settings = require('ep_etherpad-lite/node/utils/Settings');

describe(__filename, function () {
  let agent;
  const backup = {settings: {...settings}};
  const iceServers = [...Array(1000).keys()].map((i) => ({urls: [`turn:turn${i}.example.com`]}));

  const reload = async (settings = {}) => {
    await plugin.loadSettings('loadSettings', {settings: {ep_webrtc: {iceServers, ...settings}}});
  };

  const getIceServers = async (padId = common.randomString()) => {
    while (getIceServers._busy != null) {
      await getIceServers._busy;
    }
    if (++getIceServers._active >= getIceServers._limit) {
      getIceServers._busy = new Promise((resolve) => getIceServers._resolve = resolve);
    }
    try {
      const res = await agent.get(`/p/${padId}`).expect(200);
      const socket = await common.connect(res);
      try {
        const {type, data: clientVars} = await common.handshake(socket, padId);
        assert.equal(type, 'CLIENT_VARS');
        return clientVars.ep_webrtc.iceServers;
      } finally {
        socket.close();
      }
    } finally {
      if (--getIceServers._active < getIceServers._limit && getIceServers._busy != null) {
        getIceServers._resolve();
        getIceServers._busy = null;
      }
    }
  };
  getIceServers._limit = 5; // Avoid timeouts caused by overload.
  getIceServers._active = 0;
  getIceServers._resolve = () => {};

  before(async function () {
    settings.requireAuthentication = false;
    agent = await init();
  });

  after(async function () {
    Object.assign(settings, backup.settings);
    await plugin.loadSettings('loadSettings', {settings});
  });

  it('defaults to disabled', async function () {
    await reload();
    const got = await getIceServers();
    assert.deepEqual(got, iceServers);
  });

  it('explicitly disabled', async function () {
    await reload({shardIceServers: false});
    const got = await getIceServers();
    assert.deepEqual(got, iceServers);
  });

  it('enabled, zero entries', async function () {
    await reload({iceServers: [], shardIceServers: true});
    assert.deepEqual(await getIceServers(), []);
  });

  it('enabled, one entry', async function () {
    const entries = [{urls: ['turn:turn.example.com']}];
    await reload({iceServers: entries, shardIceServers: true});
    assert.deepEqual(await getIceServers(), entries);
  });

  describe('enabled, multiple entries', function () {
    beforeEach(async function () {
      await reload({shardIceServers: true});
    });

    it('only gives one entry to each client', async function () {
      const got = await getIceServers();
      assert.equal(got.length, 1);
      assert(iceServers.some((s) => {
        try {
          assert.deepEqual(got[0], s);
          return true;
        } catch (err) {
          return false;
        }
      }));
    });

    it('same pad gets same entry', async function () {
      this.timeout(60000);
      const assignments = new Map(await Promise.all([...Array(10).keys()].map(async () => {
        const padId = common.randomString();
        return [padId, await getIceServers(padId)];
      })));
      await Promise.all([...assignments].map(async ([padId, want]) => {
        const got = await getIceServers(padId);
        assert.deepEqual(got, want);
      }));
    });

    it('randomizes assignments on reload', async function () {
      this.timeout(60000);
      const oldAssignments = new Map(await Promise.all([...Array(10).keys()].map(async () => {
        const padId = common.randomString();
        return [padId, await getIceServers(padId)];
      })));
      await reload({shardIceServers: true});
      const newAssignments = new Map(await Promise.all(
          [...oldAssignments.keys()].map(async (padId) => [padId, await getIceServers(padId)])));
      // With 10 pad IDs and 1000 ICE servers, the probability that every new assignment exactly
      // matches the old assignment is effectively zero.
      assert([...newAssignments].some(([padId, newAssignment]) => {
        try {
          assert.deepEqual(newAssignment, oldAssignments.get(padId));
          return false;
        } catch (err) {
          return true;
        }
      }));
    });
  });
});
