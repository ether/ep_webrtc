'use strict';

// Generator function that yields the Cartesian product of the given iterables.
exports.cartesian = function* (head, ...tail) {
  const remainder = tail.length > 0 ? exports.cartesian(...tail) : [[]];
  for (const r of remainder) for (const h of head) yield [h, ...r];
};
