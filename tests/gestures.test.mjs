import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGestureTracker } from '../src/gestures.js';

const hit = () => '12';
const miss = () => null;

function hand(gap, { x = .28, y = .4, fingers = 'extended' } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y: y + .2 }));
  const palm = .12;
  points[9].y -= palm;
  points[4] = { x: x - gap * palm / 2, y };
  points[8] = { x: x + gap * palm / 2, y };
  if (fingers === 'fist') points[4].y = points[8].y = y + .14;
  const extendedCount = fingers === 'fist' ? 0 : fingers === 'one' ? 1 : fingers === 'two' ? 2 : fingers === 'three' ? 3 : 4;
  if (extendedCount === 0) points[8].y = y + .14;
  for (const [idx, tip] of [12, 16, 20].entries()) {
    points[tip].y -= idx + 1 < extendedCount ? .22 : .07;
  }
  return points;
}

function send(tracker, gap, time, locate = hit, opts) {
  return tracker.update(hand(gap, opts), time, 1, locate);
}

function hold(tracker) {
  send(tracker, .64, 0);
  send(tracker, .61, 90);
  send(tracker, .19, 101);
  assert.equal(send(tracker, .18, 221).open, '12');
}

test('mirrors and smooths the midpoint, then holds the pre-highlighted photo', () => {
  const tracker = createGestureTracker();
  const first = send(tracker, .64, 0);
  assert.ok(Math.abs(first.aim.x - .72) < 1e-8);
  assert.ok(Math.abs(first.aim.y - .4) < 1e-8);
  assert.equal(first.target, '12');
  const moved = send(tracker, .62, 90, hit, { x: .36 });
  assert.ok(moved.aim.x < .72 && moved.aim.x > .64);
  assert.equal(send(tracker, .19, 110, () => '13').target, '12');
  assert.equal(send(tracker, .18, 229, () => '13').open, undefined);
  assert.equal(send(tracker, .19, 230, () => '13').open, '12');
  assert.equal(send(tracker, .22, 450).open, undefined);
});

test('pinching empty space, tapping too quickly, and closing into a fist stay closed', () => {
  for (const [locate, closeAt, fingers] of [[miss, 120, 'extended'], [hit, 45, 'extended'], [hit, 120, 'fist']]) {
    const tracker = createGestureTracker();
    send(tracker, .64, 0, locate);
    assert.equal(send(tracker, .18, closeAt, locate, { fingers }).open, undefined);
    assert.equal(send(tracker, .18, closeAt + 200, hit, { fingers }).open, undefined);
  }

  const tracker = createGestureTracker();
  send(tracker, .64, 0);
  send(tracker, .2, 120);
  send(tracker, .57, 170);
  assert.equal(send(tracker, .57, 260).open, undefined);
});

test('a change of candidate restarts the highlight timer for the adjacent photo', () => {
  const tracker = createGestureTracker();
  send(tracker, .64, 0);
  send(tracker, .63, 90, () => '13');
  send(tracker, .2, 120);
  assert.equal(send(tracker, .2, 250).open, undefined);
});

test('release is debounced, and the releasing palm does not change the shape', () => {
  const tracker = createGestureTracker();
  hold(tracker);
  assert.equal(send(tracker, .51, 290).close, undefined);
  assert.equal(send(tracker, .25, 330).close, undefined);
  assert.equal(send(tracker, .95, 352).close, undefined);
  assert.equal(send(tracker, .95, 432).close, true);
  assert.equal(send(tracker, .95, 610).shape, undefined);
  assert.equal(send(tracker, .95, 850).shape, undefined);
  send(tracker, .2, 860, hit, { fingers: 'fist' });
  assert.equal(send(tracker, .2, 1010, hit, { fingers: 'fist' }).shape, 'tree');
});

test('a short tracking gap keeps the photo, then loss closes it', () => {
  const tracker = createGestureTracker();
  hold(tracker);
  assert.equal(tracker.update(null, 390, 1, hit).close, undefined);
  assert.equal(tracker.update(null, 470, 1, hit).close, undefined);
  assert.equal(tracker.update(null, 471, 1, hit).close, true);
  assert.equal(send(tracker, .18, 800).open, undefined);
});

test('a missed frame while closing preserves the candidate but restarts the hold timer', () => {
  const tracker = createGestureTracker();
  send(tracker, .64, 0);
  send(tracker, .61, 90);
  assert.equal(tracker.update(null, 115, 1, hit).target, '12');
  send(tracker, .19, 140);
  assert.equal(tracker.update(null, 190, 1, hit).target, '12');
  assert.equal(send(tracker, .20, 220).open, undefined);
  assert.equal(send(tracker, .19, 339).open, undefined);
  assert.equal(send(tracker, .19, 340).open, '12');
});

test('a new open palm switches the shape and reacquisition clears old rotation', () => {
  const tracker = createGestureTracker();
  assert.equal(send(tracker, 1.2, 0).shape, undefined);
  assert.equal(send(tracker, 1.2, 150).shape, 'nebula');
  assert.ok(send(tracker, 1.2, 180, hit, { x: .36 }).dx < 0);
  tracker.update(null, 190, 1, hit);
  assert.equal(send(tracker, 1.2, 210, hit, { x: .6 }).dx, undefined);
});

test('canceling a held pinch requires release before the same hand can open again', () => {
  const tracker = createGestureTracker();
  hold(tracker);
  tracker.cancel(250);
  assert.equal(send(tracker, .22, 520).open, undefined);
  assert.equal(send(tracker, .19, 650).open, undefined);
  send(tracker, .67, 670);
  send(tracker, .6, 780);
  send(tracker, .18, 790);
  assert.equal(send(tracker, .18, 910).open, '12');
});

test('reports pose status and smooth pressProgress across the hold window', () => {
  const tracker = createGestureTracker();
  assert.equal(tracker.update(null, 0, 1, hit).status, 'none');

  const openRes = send(tracker, 1.2, 10);
  assert.equal(openRes.status, 'open');
  assert.equal(openRes.pressProgress, 0);

  const fistRes = send(tracker, .2, 30, hit, { fingers: 'fist' });
  assert.equal(fistRes.status, 'fist');
  assert.equal(fistRes.pressProgress, 0);

  const aim1 = send(tracker, .64, 50);
  assert.equal(aim1.status, 'aim');
  assert.equal(aim1.pressProgress, 0);

  send(tracker, .61, 140);
  const startPress = send(tracker, .19, 150);
  assert.equal(startPress.status, 'press');
  assert.equal(startPress.pressProgress, 0);

  const midPress = send(tracker, .19, 210);
  assert.equal(midPress.status, 'press');
  assert.ok(Math.abs(midPress.pressProgress - .5) < 1e-6);

  const held = send(tracker, .19, 270);
  assert.equal(held.open, '12');
  assert.equal(held.status, 'held');
  assert.equal(held.pressProgress, 1);
});

test('gestures 1, 2, 3 switch to heart, ring, and spiral without triggering aim', () => {
  const tracker = createGestureTracker();

  const one0 = send(tracker, .72, 0, hit, { fingers: 'one' });
  assert.equal(one0.status, 'one');
  assert.equal(one0.aim, undefined);
  assert.equal(one0.shape, undefined);
  const one1 = send(tracker, .72, 150, hit, { fingers: 'one' });
  assert.equal(one1.status, 'one');
  assert.equal(one1.shape, 'heart');

  send(tracker, .85, 200, hit, { fingers: 'two' });
  const two1 = send(tracker, .85, 350, hit, { fingers: 'two' });
  assert.equal(two1.status, 'two');
  assert.equal(two1.shape, 'ring');

  send(tracker, .90, 400, hit, { fingers: 'three' });
  const three1 = send(tracker, .90, 550, hit, { fingers: 'three' });
  assert.equal(three1.status, 'three');
  assert.equal(three1.shape, 'spiral');

  // Pinching with relaxed/extended fingers still aims cleanly
  const aim = send(tracker, .60, 600, hit, { fingers: 'extended' });
  assert.equal(aim.status, 'aim');
  assert.equal(aim.target, '12');
});
