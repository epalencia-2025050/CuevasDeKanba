import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { operatesOn, normalizeWeekday } from '../server/store.js';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

function setupApp() {
  const config = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password',
    GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic'
  });
  const initial = withRuntime({ config }, createInitialStore);
  initial.users.push({
    id: 'admin',
    name: 'admin',
    role: 'admin',
    email: 'admin@example.invalid',
    password: initial.admin.password
  });
  initial.admin = { passwordPolicyVersion: 0 };
  const database = memoryRepository(initial);
  const services = {
    config,
    database,
    network: () => ({ secure: true, ip: '192.0.2.1' }),
    assets: async () => new Response('ok')
  };
  const app = createApp(services);
  const request = (path, cookie = '', method = 'GET', body) =>
    app.request(config.PUBLIC_URL + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: config.PUBLIC_URL,
        'Content-Type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

  async function loginAdmin() {
    const response = await request('/api/auth/login', '', 'POST', {
      email: 'admin@example.invalid',
      password: 'synthetic-password',
      role: 'admin'
    });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().find((c) => c.startsWith('kanba_user=')).split(';')[0];
  }

  return { app, request, loginAdmin, database };
}

test('normalizeWeekday maps numbers, strings, Spanish abbreviations and full names', () => {
  // Numbers 0..6
  assert.equal(normalizeWeekday(0), 0); // Sun
  assert.equal(normalizeWeekday(1), 1); // Mon
  assert.equal(normalizeWeekday(2), 2); // Tue
  assert.equal(normalizeWeekday(3), 3); // Wed
  assert.equal(normalizeWeekday(4), 4); // Thu
  assert.equal(normalizeWeekday(5), 5); // Fri
  assert.equal(normalizeWeekday(6), 6); // Sat

  // ISO Sunday 7 -> 0
  assert.equal(normalizeWeekday(7), 0);
  assert.equal(normalizeWeekday('7'), 0);

  // String digits
  assert.equal(normalizeWeekday('0'), 0);
  assert.equal(normalizeWeekday('3'), 3);
  assert.equal(normalizeWeekday('6'), 6);

  // Spanish abbreviations
  assert.equal(normalizeWeekday('Dom'), 0);
  assert.equal(normalizeWeekday('dom'), 0);
  assert.equal(normalizeWeekday('Lun'), 1);
  assert.equal(normalizeWeekday('Mar'), 2);
  assert.equal(normalizeWeekday('Mié'), 3);
  assert.equal(normalizeWeekday('Mie'), 3);
  assert.equal(normalizeWeekday('mie'), 3);
  assert.equal(normalizeWeekday('Jue'), 4);
  assert.equal(normalizeWeekday('jue'), 4);
  assert.equal(normalizeWeekday('Vie'), 5);
  assert.equal(normalizeWeekday('Sáb'), 6);
  assert.equal(normalizeWeekday('Sab'), 6);
  assert.equal(normalizeWeekday('sab'), 6);

  // Full Spanish names
  assert.equal(normalizeWeekday('Domingo'), 0);
  assert.equal(normalizeWeekday('Lunes'), 1);
  assert.equal(normalizeWeekday('Martes'), 2);
  assert.equal(normalizeWeekday('Miércoles'), 3);
  assert.equal(normalizeWeekday('Miercoles'), 3);
  assert.equal(normalizeWeekday('Jueves'), 4);
  assert.equal(normalizeWeekday('Viernes'), 5);
  assert.equal(normalizeWeekday('Sábado'), 6);
  assert.equal(normalizeWeekday('Sabado'), 6);

  // Invalid inputs
  assert.equal(normalizeWeekday(null), null);
  assert.equal(normalizeWeekday(undefined), null);
  assert.equal(normalizeWeekday('invalid'), null);
});

test('operatesOn: range 2026-11-21 to 2026-11-23 with days [Mar, Dom] (Tuesday and Sunday)', () => {
  // Calendar:
  // 2026-11-20: Friday (5) - before start
  // 2026-11-21: Saturday (6) - in range, but not Mar or Dom
  // 2026-11-22: Sunday (0) - in range, matches Dom!
  // 2026-11-23: Monday (1) - in range, but not Mar or Dom
  // 2026-11-24: Tuesday (2) - after end (out of range!)
  const tour = {
    id: 'test-mar-dom',
    startDate: '2026-11-21',
    endDate: '2026-11-23',
    days: ['Mar', 'Dom']
  };

  assert.equal(operatesOn(tour, '2026-11-20'), false, '2026-11-20 is before startDate');
  assert.equal(operatesOn(tour, '2026-11-21'), false, '2026-11-21 is Saturday, not Mar or Dom');
  assert.equal(operatesOn(tour, '2026-11-22'), true, '2026-11-22 is Sunday, matches Dom and is in range');
  assert.equal(operatesOn(tour, '2026-11-23'), false, '2026-11-23 is Monday, not Mar or Dom');
  assert.equal(operatesOn(tour, '2026-11-24'), false, '2026-11-24 is Tuesday, but outside endDate');
});

test('operatesOn: range 2026-11-21 to 2026-11-29 with days [Mar, Jue] (Tuesday and Thursday)', () => {
  // Range: 2026-11-21 (Sat) to 2026-11-29 (Sun)
  // 21 Sat, 22 Sun, 23 Mon, 24 Tue (MATCH), 25 Wed, 26 Thu (MATCH), 27 Fri, 28 Sat, 29 Sun
  const tour = {
    id: 'test-mar-jue',
    startDate: '2026-11-21',
    endDate: '2026-11-29',
    days: [2, 4] // Tuesday (2) and Thursday (4)
  };

  const datesInRange = [
    '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24',
    '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'
  ];

  const operatingDates = datesInRange.filter((date) => operatesOn(tour, date));
  assert.deepEqual(operatingDates, ['2026-11-24', '2026-11-26']);

  // Check boundaries
  assert.equal(operatesOn(tour, '2026-11-19'), false, '2026-11-19 is Thursday before startDate');
  assert.equal(operatesOn(tour, '2026-12-01'), false, '2026-12-01 is Tuesday after endDate');
});

test('operatesOn: range 2026-11-21 to 2026-11-23 with all days (0..6)', () => {
  const tour = {
    id: 'test-all-days',
    startDate: '2026-11-21',
    endDate: '2026-11-23',
    days: [0, 1, 2, 3, 4, 5, 6]
  };

  assert.equal(operatesOn(tour, '2026-11-20'), false, '2026-11-20 is before startDate');
  assert.equal(operatesOn(tour, '2026-11-21'), true, '2026-11-21 is Saturday in range');
  assert.equal(operatesOn(tour, '2026-11-22'), true, '2026-11-22 is Sunday in range');
  assert.equal(operatesOn(tour, '2026-11-23'), true, '2026-11-23 is Monday in range');
  assert.equal(operatesOn(tour, '2026-11-24'), false, '2026-11-24 is Tuesday after endDate');
});

test('operatesOn respects Spanish property names: fechaInicio, fechaFin, diasOperacion', () => {
  const tour = {
    id: 'test-es-props',
    fechaInicio: '2026-11-21',
    fechaFin: '2026-11-23',
    diasOperacion: ['Dom', 'Mar']
  };

  assert.equal(operatesOn(tour, '2026-11-20'), false);
  assert.equal(operatesOn(tour, '2026-11-21'), false);
  assert.equal(operatesOn(tour, '2026-11-22'), true);
  assert.equal(operatesOn(tour, '2026-11-23'), false);
  assert.equal(operatesOn(tour, '2026-11-24'), false);
});

test('Timezone safety: date parsing YYYY-MM-DD never shifts day of week or calendar date', () => {
  // Test dates near boundary: 2026-11-21
  const testDates = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'];
  const expectedDow = [6, 0, 1, 2, 3, 4]; // Sat, Sun, Mon, Tue, Wed, Thu

  testDates.forEach((dateStr, idx) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d, 12));
    assert.equal(utcDate.getUTCDay(), expectedDow[idx], `Day of week for ${dateStr} must be ${expectedDow[idx]}`);
    assert.equal(utcDate.toISOString().slice(0, 10), dateStr, `ISO string must match ${dateStr}`);
  });
});

test('Integration: Client and Admin availability strictly synchronize operating days and date range', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-21T12:00:00Z') });
  const { request, loginAdmin, database } = setupApp();
  const adminCookie = await loginAdmin();

  // Configure tour operating exclusively from 2026-11-21 to 2026-11-29 on Tuesdays and Thursdays
  await database.transaction((unit) => {
    unit.document.tours = [
      {
        id: 'cueva-mar-jue',
        name: 'Cueva Mar y Jue',
        active: true,
        startDate: '2026-11-21',
        endDate: '2026-11-29',
        days: ['Mar', 'Jue'],
        times: ['09:00', '14:00'],
        capacity: 10
      }
    ];
    unit.document.settings.booking = { cutoffHours: 0, advanceDays: 30 };
    unit.dirty = true;
  });

  // 1. Client availability endpoint
  const publicRes = await request('/api/availability?tour=cueva-mar-jue&days=9&from=2026-11-21');
  assert.equal(publicRes.status, 200);
  const { daysList } = await publicRes.json();

  // 2. Admin availability endpoint
  const adminRes = await request('/api/admin/availability?tour=cueva-mar-jue&days=9&from=2026-11-21', adminCookie);
  assert.equal(adminRes.status, 200);
  const { grid } = await adminRes.json();

  // Both must return only the matching dates: 2026-11-24 and 2026-11-26
  const publicDatesWithDepartures = daysList
    .filter((d) => d.tours.some((t) => t.tourId === 'cueva-mar-jue' && t.departures.length > 0))
    .map((d) => d.date);

  const adminDatesWithDepartures = grid
    .filter((d) => d.occupancy.some((o) => o.tourId === 'cueva-mar-jue' && o.times.length > 0))
    .map((d) => d.date);

  assert.deepEqual(publicDatesWithDepartures, ['2026-11-24', '2026-11-26']);
  assert.deepEqual(adminDatesWithDepartures, ['2026-11-24', '2026-11-26']);

  // Ensure slots and capacity strictly match between public and admin
  const publicSlots = daysList.find((d) => d.date === '2026-11-24').tours.find((t) => t.tourId === 'cueva-mar-jue').departures;
  const adminSlots = grid.find((d) => d.date === '2026-11-24').occupancy.find((o) => o.tourId === 'cueva-mar-jue').times;
  assert.deepEqual(publicSlots, adminSlots);
});

test('Admin modal bindOperatingDays: restricts weekdays to [2026-11-23, 2026-11-25] and handles dynamic changes', async () => {
  const source = await fs.readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  const bindCode = source.slice(source.indexOf('  function bindOperatingDays('), source.indexOf('  function openTourForm('));

  function createMockField(initialValue = '') {
    const listeners = {};
    return {
      value: initialValue,
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      trigger(type) {
        (listeners[type] || []).forEach(fn => fn());
      }
    };
  }

  function createMockChecks() {
    const dayIndices = [1, 2, 3, 4, 5, 6, 0];
    const inputs = dayIndices.map(index => {
      const classSet = new Set(['inline-check']);
      const label = {
        classList: {
          toggle(cls, force) {
            if (force) classSet.add(cls);
            else classSet.delete(cls);
          },
          contains(cls) { return classSet.has(cls); }
        },
        title: ''
      };
      const input = {
        name: 'days',
        value: String(index),
        checked: false,
        disabled: false,
        parentElement: label,
        closest(sel) { return sel === 'label' ? label : null; }
      };
      return input;
    });

    return {
      inputs,
      querySelectorAll(sel) {
        if (sel === 'input') return inputs;
        return [];
      }
    };
  }

  const context = vm.createContext({
    Date,
    Number,
    Set,
    String,
    isNaN,
    bindOperatingDays: null
  });
  vm.runInContext(bindCode + '\nthis.bindOperatingDays = bindOperatingDays;', context);
  const { bindOperatingDays } = context;

  // 1. Initial configuration: 2026-11-23 to 2026-11-25 (Monday to Wednesday)
  const startField = createMockField('2026-11-23');
  const endField = createMockField('2026-11-25');
  const checks = createMockChecks();

  const selectDays = bindOperatingDays(startField, endField, checks);

  // Check which days are enabled/disabled
  // 2026-11-23 = Lun (1), 2026-11-24 = Mar (2), 2026-11-25 = Mié (3)
  const enabledDays = checks.inputs.filter(i => !i.disabled).map(i => Number(i.value));
  const disabledDays = checks.inputs.filter(i => i.disabled).map(i => Number(i.value));

  assert.deepEqual(enabledDays, [1, 2, 3], 'Only Lun, Mar, Mié should be enabled');
  assert.deepEqual(disabledDays, [4, 5, 6, 0], 'Jue, Vie, Sáb, Dom must be disabled');

  // Verify visual styling and title on disabled labels
  disabledDays.forEach(day => {
    const input = checks.inputs.find(i => Number(i.value) === day);
    assert.equal(input.parentElement.classList.contains('is-disabled'), true);
    assert.match(input.parentElement.title, /no cae dentro del rango/);
    assert.equal(input.checked, false);
  });

  // 2. Shortcut "Todos" should only activate enabled days
  selectDays(() => true);
  const checkedAfterTodos = checks.inputs.filter(i => i.checked).map(i => Number(i.value));
  assert.deepEqual(checkedAfterTodos, [1, 2, 3], 'Todos should only check enabled days (1, 2, 3)');

  // Shortcut "Entre semana"
  selectDays(day => day >= 1 && day <= 5);
  const checkedAfterWeekdays = checks.inputs.filter(i => i.checked).map(i => Number(i.value));
  assert.deepEqual(checkedAfterWeekdays, [1, 2, 3], 'Entre semana should only check 1, 2, 3 in range');

  // 3. Dynamic change: Reduce range to 2026-11-23 .. 2026-11-24
  endField.value = '2026-11-24';
  endField.trigger('input');

  const enabledAfterShrink = checks.inputs.filter(i => !i.disabled).map(i => Number(i.value));
  const checkedAfterShrink = checks.inputs.filter(i => i.checked).map(i => Number(i.value));
  assert.deepEqual(enabledAfterShrink, [1, 2], 'Only Lun, Mar enabled after shrinking');
  assert.deepEqual(checkedAfterShrink, [1, 2], 'Mié (3) should be automatically unchecked when disabled');

  // 4. Dynamic change: Expand range to 2026-11-29 (Mon through Sun)
  endField.value = '2026-11-29';
  endField.trigger('input');

  const enabledAfterExpand = checks.inputs.filter(i => !i.disabled).map(i => Number(i.value));
  assert.deepEqual(enabledAfterExpand, [1, 2, 3, 4, 5, 6, 0], 'All 7 days should be enabled');
  // Previously checked days 1 and 2 should remain checked
  assert.deepEqual(checks.inputs.filter(i => i.checked).map(i => Number(i.value)), [1, 2]);

  // 5. Open or invalid range: Clear dates
  endField.value = '';
  endField.trigger('change');
  assert.equal(checks.inputs.every(i => !i.disabled), true, 'Open range enables all days');

  // Inverted dates: 2026-11-25 to 2026-11-23
  startField.value = '2026-11-25';
  endField.value = '2026-11-23';
  startField.trigger('change');
  assert.equal(checks.inputs.every(i => !i.disabled), true, 'Invalid range does not break/block unexpectedly');
});
