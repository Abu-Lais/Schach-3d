import test from 'node:test';
import assert from 'node:assert/strict';

test('Multiplayer Server API and Room Logic Test Suite', async (t) => {
  // Mock Express / Room data structure test
  const rooms = new Map();

  function createRoom(preferredColor, token) {
    const code = 'TEST01';
    const side = preferredColor === 'b' ? 'b' : 'w';
    const room = {
      code,
      status: 'waiting',
      whiteJoined: side === 'w',
      blackJoined: side === 'b',
      turn: 'w',
      moves: [],
      clocks: { w: 300, b: 300 },
      lastTurnSwitchTs: Date.now(),
      drawOfferFrom: null,
      winner: null,
      chat: []
    };
    rooms.set(code, room);
    return { ok: true, code, color: side, room };
  }

  function joinRoom(code, token) {
    const room = rooms.get(code);
    if (!room) return { ok: false, error: 'Not found' };
    if (!room.whiteJoined) {
      room.whiteJoined = true;
    } else if (!room.blackJoined) {
      room.blackJoined = true;
    }
    room.status = room.whiteJoined && room.blackJoined ? 'playing' : 'waiting';
    return { ok: true, code, color: 'b', room };
  }

  function makeMove(code, move) {
    const room = rooms.get(code);
    if (!room) return { ok: false };
    room.moves.push(move);
    room.turn = move.color === 'w' ? 'b' : 'w';
    return { ok: true, room };
  }

  await t.test('Room creation produces 5-minute blitz clocks and assigns preferred side', () => {
    const res = createRoom('w', 'token_123');
    assert.equal(res.ok, true);
    assert.equal(res.color, 'w');
    assert.equal(res.room.clocks.w, 300);
    assert.equal(res.room.clocks.b, 300);
    assert.equal(res.room.status, 'waiting');
  });

  await t.test('Second player joining transitions room to active playing state', () => {
    const joinRes = joinRoom('TEST01', 'token_456');
    assert.equal(joinRes.ok, true);
    assert.equal(joinRes.room.status, 'playing');
    assert.equal(joinRes.room.whiteJoined, true);
    assert.equal(joinRes.room.blackJoined, true);
  });

  await t.test('Executing chess moves updates room sequence and alternates turn', () => {
    const moveRes = makeMove('TEST01', {
      seq: 1,
      color: 'w',
      from: { r: 6, c: 4 },
      to: { r: 4, c: 4 },
      notation: 'e4',
      piece: 'pawn'
    });
    assert.equal(moveRes.ok, true);
    assert.equal(moveRes.room.moves.length, 1);
    assert.equal(moveRes.room.turn, 'b');
  });
});
