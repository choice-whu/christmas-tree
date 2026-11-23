const POSE_MS = 150;
const LOST_MS = 250;
const AIM_GAP_MS = 105;
const TARGET_MS = 85;
const HOLD_MS = 120;
const RELEASE_MS = 80;
const QUIET_MS = 260;
const CLOSED = .30;
const RELEASED = .48;
const AIM_LIMIT = .82;
const COUNT_MIN_GAP = .58;
const POSE_TO_SHAPE = {
  fist: 'tree',
  open: 'nebula',
  one: 'heart',
  two: 'ring',
  three: 'spiral',
};

function measureHand(points, aspect, previousPose) {
  if (points?.length !== 21) return null;
  const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
  const palm = distance(0, 9);
  if (palm < .012) return null;

  const gap = distance(4, 8) / palm;
  const index = distance(0, 8) / palm;
  const others = [12, 16, 20].map(tip => distance(0, tip) / palm);
  const curl = previousPose === 'fist' ? 1.18 : 1.10;
  const fist = index < curl && others.every(length => length < curl);
  const open = gap >= AIM_LIMIT && index > 1.27 && others.every(length => length > 1.25);

  const isExtended = (tip, pip) => {
    const tipDist = distance(0, tip);
    if (tipDist / palm <= 1.24) return false;
    const pipDist = distance(0, pip);
    return pipDist < .001 || tipDist > pipDist * 1.08;
  };
  const isCurled = (tip, pip) => {
    const tipDist = distance(0, tip);
    if (tipDist / palm >= 1.15) return false;
    const pipDist = distance(0, pip);
    return pipDist < .001 || tipDist < pipDist * 1.12;
  };

  let pose = 'neutral';
  if (fist) pose = 'fist';
  else if (open) pose = 'open';
  else if (gap >= COUNT_MIN_GAP) {
    const indexExt = isExtended(8, 6);
    const middleExt = isExtended(12, 10);
    const ringExt = isExtended(16, 14);
    const middleCurl = isCurled(12, 10);
    const ringCurl = isCurled(16, 14);
    const pinkyCurl = isCurled(20, 18);
    if (indexExt && middleCurl && ringCurl && pinkyCurl) pose = 'one';
    else if (indexExt && middleExt && ringCurl && pinkyCurl) pose = 'two';
    else if (indexExt && middleExt && ringExt && pinkyCurl) pose = 'three';
  }

  return {
    gap,
    pose,
    canAim: !fist && (index >= 1.07 || others.filter(length => length > 1.25).length >= 2),
    tip: {
      x: Math.max(0, Math.min(1, 1 - (points[4].x + points[8].x) / 2)),
      y: Math.max(0, Math.min(1, (points[4].y + points[8].y) / 2)),
    },
    palm: {
      x: (points[0].x + points[5].x + points[17].x) / 3,
      y: (points[0].y + points[5].y + points[17].y) / 3,
    },
  };
}

export function createGestureTracker() {
  let lastSeen = -Infinity;
  let pose = 'neutral';
  let poseCandidate = 'neutral';
  let poseSince = 0;
  let previousPalm = null;
  let velocityX = 0;
  let velocityY = 0;
  let quietUntil = 0;

  let phase = 'idle';
  let tip = null;
  let tipTime = 0;
  let target = null;
  let targetSince = 0;
  let pressSince = 0;
  let releaseSince = null;

  function resetMotion() {
    previousPalm = null;
    velocityX = 0;
    velocityY = 0;
  }

  function resetAim(nextPhase = 'idle') {
    phase = nextPhase;
    tip = null;
    target = null;
    releaseSince = null;
  }

  function finishHold(now, hand) {
    resetAim();
    resetMotion();
    quietUntil = now + QUIET_MS;
    // Consume the posture used to release the picture. A new shape needs a new pose.
    pose = poseCandidate = hand?.pose ?? 'neutral';
    poseSince = now;
    return { close: true, status: pose, pressProgress: 0 };
  }

  function moveScene(hand, now) {
    if (now < quietUntil) {
      pose = poseCandidate = hand.pose;
      poseSince = now;
      resetMotion();
      return { status: hand.pose, pressProgress: 0 };
    }
    let shape;
    if (poseCandidate !== hand.pose) {
      poseCandidate = hand.pose;
      poseSince = now;
    }
    if (pose !== poseCandidate && now - poseSince >= POSE_MS) {
      pose = poseCandidate;
      shape = POSE_TO_SHAPE[pose];
    }
    if (pose !== 'open' || hand.pose !== 'open') {
      resetMotion();
      return { shape, status: hand.pose, pressProgress: 0 };
    }
    const previous = previousPalm;
    previousPalm = hand.palm;
    if (!previous) return { shape, status: 'open', pressProgress: 0 };
    const rx = Math.max(-.095, Math.min(.095, (previous.x - hand.palm.x) * 2.45));
    const ry = Math.max(-.065, Math.min(.065, (hand.palm.y - previous.y) * 1.85));
    velocityX += (rx - velocityX) * .50;
    velocityY += (ry - velocityY) * .50;
    return { shape, dx: velocityX, dy: velocityY, status: 'open', pressProgress: 0 };
  }

  return {
    cancel(now) {
      finishHold(now, null);
      phase = 'blocked';
    },
    update(points, now, aspect, locate) {
      const hand = measureHand(points, aspect, pose);
      if (!hand) {
        resetMotion();
        poseCandidate = pose;
        if (phase === 'held') {
          releaseSince = null;
          return now - lastSeen >= LOST_MS ? finishHold(now, null) : { status: 'held', pressProgress: 1 };
        }
        if ((phase === 'aim' || phase === 'press') && now - lastSeen <= AIM_GAP_MS) {
          if (phase === 'press') pressSince = null;
          if (phase === 'aim' && lastSeen - targetSince < TARGET_MS) targetSince = now;
          return { aim: tip, target, status: phase, pressProgress: 0 };
        }
        if (phase === 'press') resetAim('blocked');
        if (phase === 'aim') resetAim();
        if (now - lastSeen >= LOST_MS) {
          pose = poseCandidate = 'neutral';
          resetAim();
        }
        return { status: 'none', pressProgress: 0 };
      }
      lastSeen = now;

      if (phase === 'held') {
        if (hand.gap < RELEASED) {
          releaseSince = null;
          return { status: 'held', pressProgress: 1 };
        }
        if (releaseSince === null) releaseSince = now;
        return now - releaseSince >= RELEASE_MS ? finishHold(now, hand) : { status: 'held', pressProgress: 1 };
      }

      if (now < quietUntil) return moveScene(hand, now);

      if (phase === 'press') {
        if (hand.gap >= RELEASED) resetAim();
        else if (!hand.canAim) resetAim('blocked');
        else {
          if (pressSince === null) pressSince = now;
          const elapsed = now - pressSince;
          if (elapsed >= HOLD_MS) {
            phase = 'held';
            return { open: target, status: 'held', pressProgress: 1 };
          }
          return { aim: tip, target, status: 'press', pressProgress: Math.min(1, Math.max(0, elapsed / HOLD_MS)) };
        }
      }

      if (phase === 'blocked') {
        if (hand.gap >= RELEASED) resetAim();
        else return moveScene(hand, now);
      }

      const isCountPose = hand.pose === 'one' || hand.pose === 'two' || hand.pose === 'three';
      const aimingActive = phase === 'aim' || phase === 'press';
      if (hand.canAim && hand.gap < AIM_LIMIT && (!isCountPose || aimingActive)) {
        resetMotion();
        poseCandidate = pose;
        if (hand.gap <= CLOSED) {
          if (phase === 'aim' && target !== null && now - targetSince >= TARGET_MS) {
            phase = 'press';
            pressSince = now;
            return { aim: tip, target, status: 'press', pressProgress: 0 };
          }
          resetAim('blocked');
          return { status: hand.pose, pressProgress: 0 };
        }
        const mix = tip ? 1 - Math.exp(-(now - tipTime) / 64) : 1;
        tip = tip
          ? { x: tip.x + (hand.tip.x - tip.x) * mix, y: tip.y + (hand.tip.y - tip.y) * mix }
          : hand.tip;
        tipTime = now;
        phase = 'aim';
        const hit = locate(tip);
        if (target !== hit) {
          target = hit;
          targetSince = now;
        }
        return { aim: tip, target, status: 'aim', pressProgress: 0 };
      }

      resetAim(hand.gap < RELEASED ? 'blocked' : 'idle');
      return moveScene(hand, now);
    },
  };
}
