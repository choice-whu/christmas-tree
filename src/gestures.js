const POSE_MS = 150;
const LOST_MS = 250;
const AIM_GAP_MS = 105;
const TARGET_MS = 85;
const HOLD_MS = 120;
const RELEASE_MS = 80;
const QUIET_MS = 260;
const CLOSED = .36;
const RELEASED = .50;
const AIM_ENTER = .80;
const AIM_EXIT = .90;
const AIM_EXIT_MS = 90;
const FREEZE_GAP = .46;
const ONE_MIN_GAP = .68;
const TWO_MIN_GAP = .58;
const THREE_MIN_GAP = .55;
const WAY_B_MAX_GAP = .32;
const TARGET_GRACE_MS = 75;
const POSE_TO_SHAPE = {
  fist: 'tree',
  open: 'nebula',
  one: 'heart',
  two: 'ring',
  three: 'spiral',
};

function measureHand(points, aspect, previousPose, isPinching = false) {
  if (points?.length !== 21) return null;
  const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
  const palm = Math.max(distance(0, 9), distance(5, 17) * 1.15);
  if (palm < .012) return null;

  const gap = distance(4, 8) / palm;
  const index = distance(0, 8) / palm;
  const others = [12, 16, 20].map(tip => distance(0, tip) / palm);
  const curl = previousPose === 'fist' ? 1.18 : 1.10;
  const hasAnyJoints = distance(0, 6) >= .001 && distance(5, 6) >= .001;

  const jointCos = (mcp, pip, tip) => {
    const v1x = (points[pip].x - points[mcp].x) * aspect;
    const v1y = points[pip].y - points[mcp].y;
    const v2x = (points[tip].x - points[pip].x) * aspect;
    const v2y = points[tip].y - points[pip].y;
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 < .001 || n2 < .001) return 0;
    return (v1x * v2x + v1y * v2y) / (n1 * n2);
  };

  const isExtended = (tip, pip, mcp) => {
    const tipDist = distance(0, tip);
    const pipDist = distance(0, pip);
    const mcpPipDist = distance(mcp, pip);
    const hasJoints = pipDist >= .001 && mcpPipDist >= .001;
    if (!hasJoints) return tipDist / palm > 1.24;
    return tipDist / palm > 1.22 && tipDist > pipDist * 1.12 && jointCos(mcp, pip, tip) > .35;
  };

  const isCurled = (tip, pip, mcp) => {
    const tipDist = distance(0, tip);
    const pipDist = distance(0, pip);
    const mcpPipDist = distance(mcp, pip);
    const hasJoints = pipDist >= .001 && mcpPipDist >= .001;
    if (!hasJoints) return tipDist / palm < 1.15;
    if (tipDist / palm < 1.16) return true;
    const cos = jointCos(mcp, pip, tip);
    return tipDist / palm < 1.38 && (tipDist <= pipDist * 1.10 || cos <= .32);
  };

  const isTightCurled = (tip, pip, mcp) => {
    const tipDist = distance(0, tip);
    const pipDist = distance(0, pip);
    const mcpPipDist = distance(mcp, pip);
    const hasJoints = pipDist >= .001 && mcpPipDist >= .001;
    if (!hasJoints) return tipDist / palm < curl;
    return tipDist / palm < 1.12 || (tipDist <= pipDist * 1.02 && jointCos(mcp, pip, tip) < .05 && tipDist / palm < 1.30);
  };

  const indexExt = isExtended(8, 6, 5);
  const middleExt = isExtended(12, 10, 9);
  const ringExt = isExtended(16, 14, 13);
  const pinkyExt = isExtended(20, 18, 17);
  const indexCurl = isCurled(8, 6, 5);
  const middleCurl = isCurled(12, 10, 9);
  const ringCurl = isCurled(16, 14, 13);
  const pinkyCurl = isCurled(20, 18, 17);
  const indexTight = isTightCurled(8, 6, 5);
  const middleTight = isTightCurled(12, 10, 9);
  const ringTight = isTightCurled(16, 14, 13);
  const pinkyTight = isTightCurled(20, 18, 17);

  let fist;
  if (!hasAnyJoints) {
    fist = index < curl && others.every(length => length < curl);
  } else if (previousPose === 'fist') {
    fist = !indexExt && !middleExt && !ringExt && !pinkyExt && indexCurl && middleCurl && ringCurl && pinkyCurl;
  } else if (isPinching) {
    fist = index < 1.12 && indexTight && middleTight && ringTight && pinkyTight;
  } else {
    fist = indexTight && middleTight && ringTight && pinkyTight && others.every(length => length < 1.26);
  }

  const openLimit = previousPose === 'open' ? AIM_ENTER : AIM_EXIT;
  const open = gap >= openLimit && indexExt && middleExt && ringExt && pinkyExt;
  const straightOuterThree = hasAnyJoints
    ? jointCos(9, 10, 12) > .50 && jointCos(13, 14, 16) > .50 && jointCos(17, 18, 20) > .50
    : true;

  let pose = 'neutral';
  if (fist) pose = 'fist';
  else if (open) pose = 'open';
  else if (gap >= ONE_MIN_GAP && indexExt && middleCurl && ringCurl && pinkyCurl) pose = 'one';
  else if (gap >= TWO_MIN_GAP && indexExt && middleExt && ringCurl && pinkyCurl) pose = 'two';
  else if (gap >= THREE_MIN_GAP && indexExt && middleExt && ringExt && !pinkyExt && (pinkyCurl || (previousPose === 'three' && distance(0, 20) / palm < 1.40))) pose = 'three';
  else if (gap <= WAY_B_MAX_GAP && !indexExt && middleExt && ringExt && pinkyExt && straightOuterThree && (indexCurl || !hasAnyJoints || index < 1.32)) pose = 'three';

  return {
    gap,
    pose,
    canAim: !fist && (index >= 1.02 || others.filter(length => length > 1.25).length >= 2),
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
  let missSince = null;
  let aimExitSince = null;
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
    missSince = null;
    aimExitSince = null;
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
      const isPinching = phase === 'aim' || phase === 'press' || phase === 'held';
      const hand = measureHand(points, aspect, pose, isPinching);
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
        else if (hand.pose === 'fist') resetAim('blocked');
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

      const isWayB = hand.pose === 'three' && hand.gap <= WAY_B_MAX_GAP;
      const isCountPose = hand.pose === 'one' || hand.pose === 'two' || hand.pose === 'three';
      const lockAim = phase === 'press' || (phase === 'aim' && target !== null && (hand.gap < .72 || isWayB));
      const inAimBand = phase === 'aim' ? hand.gap < AIM_EXIT : hand.gap < AIM_ENTER;

      if (phase === 'aim' && hand.canAim && !isCountPose && hand.gap >= AIM_EXIT) {
        if (aimExitSince === null) aimExitSince = now;
        if (now - aimExitSince < AIM_EXIT_MS) {
          resetMotion();
          locate(tip, target);
          return { aim: tip, target, status: 'aim', pressProgress: 0 };
        }
      } else if (inAimBand) {
        aimExitSince = null;
      }

      if (hand.canAim && inAimBand && (!isCountPose || lockAim)) {
        resetMotion();
        poseCandidate = pose;
        if (hand.gap <= CLOSED) {
          if (phase === 'aim' && target !== null && now - targetSince >= TARGET_MS) {
            phase = 'press';
            pressSince = now;
            return { aim: tip, target, status: 'press', pressProgress: 0 };
          }
          resetAim('blocked');
          if (hand.pose === 'three') return moveScene(hand, now);
          return { status: hand.pose, pressProgress: 0 };
        }
        if (phase === 'aim' && target !== null && hand.gap <= FREEZE_GAP) {
          tipTime = now;
          missSince = null;
          locate(tip, target);
          return { aim: tip, target, status: 'aim', pressProgress: 0 };
        }
        const tau = target !== null ? 85 : 58;
        const mix = tip ? 1 - Math.exp(-(now - tipTime) / tau) : 1;
        tip = tip
          ? { x: tip.x + (hand.tip.x - tip.x) * mix, y: tip.y + (hand.tip.y - tip.y) * mix }
          : hand.tip;
        tipTime = now;
        phase = 'aim';
        const hit = locate(tip, target);
        if (hit !== null) {
          missSince = null;
          if (target !== hit) {
            target = hit;
            targetSince = now;
          }
        } else if (target !== null) {
          if (missSince === null) missSince = now;
          if (now - missSince >= TARGET_GRACE_MS) {
            target = null;
            targetSince = now;
            missSince = null;
          }
        } else {
          targetSince = now;
          missSince = null;
        }
        return { aim: tip, target, status: 'aim', pressProgress: 0 };
      }

      resetAim(hand.gap < RELEASED ? 'blocked' : 'idle');
      return moveScene(hand, now);
    },
  };
}
