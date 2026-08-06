'use strict';
/* Declarative camera-movement DSL. Each helper returns an array of animate
 * specs that can be assigned directly to scene.three.cameraAnimate. */

/** Slow circular orbit around a target point.
 *
 *  example:
 *    cameraAnimate: orbitCamera(0, 8, { target: [0, 2, 0], radius: 6, height: 3 })
 */
function orbitCamera(at, duration, opts = {}) {
  const target = opts.target || [0, 0, 0];
  const radius = opts.radius || 5;
  const height = opts.height || 2;
  const segments = opts.segments || 4;
  const ease = opts.ease || 'none';

  const anims = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 / segments) * (i + 1);
    anims.push({
      property: 'position.x',
      to: target[0] + Math.cos(angle) * radius,
      duration: duration / segments,
      ease: i === 0 ? 'power2.inOut' : ease,
      wait: (duration / segments) * i,
    });
    anims.push({
      property: 'position.z',
      to: target[2] + Math.sin(angle) * radius,
      duration: duration / segments,
      ease: i === 0 ? 'power2.inOut' : ease,
      wait: (duration / segments) * i,
    });
  }
  return anims;
}

/** Dolly / zoom: animate field of view.
 *
 *  example:
 *    cameraAnimate: dollyCamera(0, { from: 45, to: 20, duration: 4 })
 */
function dollyCamera(at, opts = {}) {
  const from = opts.from || 45;
  const to = opts.to || 20;
  const duration = opts.duration || 4;
  const ease = opts.ease || 'power2.inOut';
  return [{ property: 'fov', from, to, duration, ease }];
}

/** Lateral pan: move camera position along one axis.
 *
 *  example:
 *    cameraAnimate: panCamera(0, { axis: 'x', amount: 3, duration: 5 })
 */
function panCamera(at, opts = {}) {
  const axis = opts.axis || 'x';
  const amount = opts.amount || 3;
  const duration = opts.duration || 4;
  const ease = opts.ease || 'power2.inOut';
  return [{
    property: `position.${axis}`,
    to: `C.position.${axis}+${amount}`,
    duration,
    ease,
  }];
}

/** Boom / crane: move camera height.
 *
 *  example:
 *    cameraAnimate: boomCamera(0, { from: 1, to: 8, duration: 6 })
 */
function boomCamera(at, opts = {}) {
  const from = opts.from || 1;
  const to = opts.to || 5;
  const duration = opts.duration || 4;
  const ease = opts.ease || 'power2.inOut';
  return [{ property: 'position.y', from, to, duration, ease }];
}

/** Look-at pan: shift the focal point across a scene.
 *
 *  example:
 *    cameraAnimate: lookAtPan(0, { axis: 'x', amount: 4, duration: 5 })
 */
function lookAtPan(at, opts = {}) {
  const axis = opts.axis || 'x';
  const amount = opts.amount || 2;
  const duration = opts.duration || 4;
  const ease = opts.ease || 'power2.inOut';
  return [{ property: `lookAt.${axis}`, to: amount, duration, ease }];
}

module.exports = { orbitCamera, dollyCamera, panCamera, boomCamera, lookAtPan };
