import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherKind, toMinutes, phaseOf, skyArc, moonPhase, aqiLabel, render } from './santiago.mjs';

test('maps WMO weather codes to scene kinds', () => {
  assert.equal(weatherKind(0), 'clear');
  assert.equal(weatherKind(2), 'partly');
  assert.equal(weatherKind(3), 'overcast');
  assert.equal(weatherKind(45), 'fog');
  assert.equal(weatherKind(63), 'rain');
  assert.equal(weatherKind(81), 'rain');
  assert.equal(weatherKind(75), 'snow');
  assert.equal(weatherKind(95), 'storm');
});

test('reads local minutes from open-meteo timestamps', () => {
  assert.equal(toMinutes('2026-09-23T07:12'), 432);
  assert.equal(toMinutes('T23:59'), 1439);
});

test('derives the phase of the day around sunrise and sunset', () => {
  const [sunrise, sunset] = [420, 1170];
  assert.equal(phaseOf(300, sunrise, sunset), 'night');
  assert.equal(phaseOf(430, sunrise, sunset), 'dawn');
  assert.equal(phaseOf(800, sunrise, sunset), 'day');
  assert.equal(phaseOf(1180, sunrise, sunset), 'dusk');
  assert.equal(phaseOf(1300, sunrise, sunset), 'night');
});

test('puts the sun up by day and the moon up by night', () => {
  assert.deepEqual(skyArc(795, 420, 1170), { body: 'sun', t: 0.5 });
  const night = skyArc(1170 + 345, 420, 1170);
  assert.equal(night.body, 'moon');
  assert.ok(Math.abs(night.t - 0.5) < 0.01);
});

test('knows the moon phase', () => {
  assert.ok(Math.abs(moonPhase(new Date('2024-01-25T17:54Z')) - 0.5) < 0.03);
  const newMoon = moonPhase(new Date('2024-01-11T11:57Z'));
  assert.ok(newMoon < 0.03 || newMoon > 0.97);
});

test('labels air quality', () => {
  assert.equal(aqiLabel(null), null);
  assert.equal(aqiLabel(30), 'good');
  assert.equal(aqiLabel(80), 'moderate');
  assert.equal(aqiLabel(140), 'smoggy');
  assert.equal(aqiLabel(200), 'smog alert');
});

test('renders a complete svg for every weather and time of day', () => {
  for (const kind of ['clear', 'partly', 'overcast', 'fog', 'rain', 'snow', 'storm']) {
    for (const minutes of [180, 430, 800, 1180]) {
      const svg = render({
        minutes, sunrise: 420, sunset: 1170, kind, cloudCover: 50,
        temp: 18, aqi: 120, clock: '12:00', date: new Date('2026-09-23T12:00Z'), seed: 1,
      });
      assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
      assert.match(svg, /id="costanera"/);
      assert.match(svg, /SANTIAGO DE CHILE/);
    }
  }
});
