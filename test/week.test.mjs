// Week rows: the color of each hour's wind bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';

// The light theme's stops, from src/style.css.
const LIGHT = ['#2E8B57', '#9DB23F', '#D8B31E', '#E59400', '#D9381E', '#8F2413'];
const color = (kn) => Engine.windColor(kn, 15, LIGHT);

test('the speed is rounded to whole knots before it is colored', () => {
  assert.equal(color(15.4), color(15));
  assert.equal(color(15.6), color(16));
  assert.notEqual(color(15), color(16));
});

test('yellow ends at the limit, and amber starts just over it', () => {
  assert.equal(color(15), 'rgb(216, 179, 30)');
  // 16 kn is about a fifth of the way from amber, at the limit, to red, at 1.33 times the limit.
  assert.equal(color(16), 'rgb(227, 129, 6)');
});

test('the stops fall at their shares of the limit', () => {
  assert.equal(color(0), 'rgb(46, 139, 87)');
  assert.equal(color(9), 'rgb(46, 139, 87)');     // 0.60 of the limit
  assert.equal(Engine.rampColor(0.87, LIGHT), 'rgb(157, 178, 63)');
  assert.equal(Engine.rampColor(1.33, LIGHT), 'rgb(217, 56, 30)');
  assert.equal(color(27), 'rgb(143, 36, 19)');    // 1.80 of the limit
  assert.equal(color(40), 'rgb(143, 36, 19)');
});

test('between two stops the color moves in a straight line in RGB', () => {
  // 0.735 of the limit is halfway from green to yellow-green.
  assert.equal(Engine.rampColor(0.735, LIGHT), 'rgb(102, 159, 75)');
});
