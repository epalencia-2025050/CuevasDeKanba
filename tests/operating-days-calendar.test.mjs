import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
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
  for (const role of ['user', 'admin']) {
    initial.users.push({
      id: role,
      name: role,
      role,
      email: `${role}@example.invalid`,
      password: initial.admin.password
    });
  }
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

  async function loginUser() {
    const response = await request('/api/auth/login', '', 'POST', {
      email: 'user@example.invalid',
      password: 'synthetic-password',
      role: 'user'
    });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().find((c) => c.startsWith('kanba_user=')).split(';')[0];
  }

  return { app, request, loginAdmin, loginUser, database };
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

  // 6. Tour fijo / recurrente checkbox: When isFixedCheck is checked, all days remain enabled regardless of date range
  const fixedCheck = {
    name: 'isFixed',
    checked: true,
    addEventListener(type, fn) {
      this._listener = fn;
    },
    trigger() {
      if (this._listener) this._listener();
    }
  };
  startField.value = '2026-11-23';
  endField.value = '2026-11-24'; // Only Lun and Mar if bounded
  bindOperatingDays(startField, endField, checks, fixedCheck);
  assert.equal(checks.inputs.every(i => !i.disabled), true, 'Fixed tour mode keeps all 7 weekdays enabled');

  // Unchecking fixed mode restores the closed date range limitation
  fixedCheck.checked = false;
  fixedCheck.trigger();
  const enabledAfterUncheck = checks.inputs.filter(i => !i.disabled).map(i => Number(i.value));
  assert.deepEqual(enabledAfterUncheck, [1, 2], 'Disabling fixed mode reapplies the date range filter');
});

test('Recurring tours (isFixed): weekly recurrence, per-date seat independence, sold-out behavior and hold release', async () => {
  const { request, loginAdmin, loginUser, database } = setupApp();
  const adminCookie = await loginAdmin();
  const userCookie = await loginUser();

  // 1. Admin creates recurring tour with Mondays (1) and Fridays (5), without closed date range
  const createTourRes = await request('/api/admin/tours', adminCookie, 'POST', {
    name: 'Aventura Recurrente Kanba',
    isFixed: true,
    price: 150,
    capacity: 10,
    maxParticipants: 10,
    duration: '3 horas',
    durationMinutes: 180,
    difficulty: 'Moderada',
    times: ['10:00'],
    days: [1, 5] // Mondays and Fridays
  });
  assert.equal(createTourRes.status, 201);
  const createdTourData = await createTourRes.json();
  assert.equal(createdTourData.tour.isFixed, true);
  assert.equal(createdTourData.tour.startDate, '');
  assert.equal(createdTourData.tour.endDate, '');
  const tourId = createdTourData.tour.id;

  // Configure advance booking policy allowing up to 60 days and higher pending limit for test suite
  await database.transaction((unit) => {
    unit.document.settings.booking = { cutoffHours: 0, advanceDays: 60, holdMinutes: 20, pendingLimit: 20 };
    unit.dirty = true;
  });

  // 2. Query availability over 14 days starting 2026-11-30 (Monday)
  // Calendar dates:
  // 2026-11-30: Monday (Week 1)
  // 2026-12-04: Friday (Week 1)
  // 2026-12-07: Monday (Week 2)
  // 2026-12-11: Friday (Week 2)
  const availRes = await request(`/api/availability?tour=${tourId}&days=14&from=2026-11-30`);
  assert.equal(availRes.status, 200);
  const { daysList } = await availRes.json();
  const operatingDates = daysList.map(d => d.date);
  assert.deepEqual(operatingDates, ['2026-11-30', '2026-12-04', '2026-12-07', '2026-12-11']);

  // All departures start with 10 available seats
  daysList.forEach(day => {
    const tourEntry = day.tours.find(t => t.tourId === tourId);
    assert.ok(tourEntry);
    assert.equal(tourEntry.departures[0].capacity, 10);
    assert.equal(tourEntry.departures[0].left, 10);
    assert.equal(tourEntry.departures[0].status, 'open');
  });

  const customer = (name = 'Turista Valido') => ({
    name,
    email: 'viajero@example.invalid',
    phone: '55551111',
    country: 'Guatemala',
    acceptPolicies: true,
    acceptTerms: true
  });

  // 3. Independent seat availability: Book 2 seats on Week 1 Monday (2026-11-30 at 10:00)
  const bookRes1 = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2026-11-30',
    time: '10:00',
    participants: 2,
    customer: customer('Grupo Uno'),
    participantNames: ['Persona 1', 'Persona 2']
  });
  assert.equal(bookRes1.status, 201);
  const book1Json = await bookRes1.json();
  assert.ok(book1Json.code);

  // Check availability again:
  // Week 1 Monday must have 8 seats left (10 - 2)
  // Week 2 Monday (2026-12-07) MUST still have 10 seats left! (Per-date natural decoupling)
  const availRes2 = await request(`/api/availability?tour=${tourId}&days=14&from=2026-11-30`);
  const { daysList: daysList2 } = await availRes2.json();

  const w1Mon = daysList2.find(d => d.date === '2026-11-30').tours.find(t => t.tourId === tourId).departures[0];
  const w2Mon = daysList2.find(d => d.date === '2026-12-07').tours.find(t => t.tourId === tourId).departures[0];

  assert.equal(w1Mon.left, 8, 'Week 1 Monday has 8 seats left');
  assert.equal(w1Mon.taken, 2);
  assert.equal(w2Mon.left, 10, 'Week 2 Monday remains untouched with 10 seats left');
  assert.equal(w2Mon.taken, 0);

  // 4. Fill remaining 8 seats on Week 1 Monday
  const bookRes2 = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2026-11-30',
    time: '10:00',
    participants: 8,
    customer: customer('Grupo Dos'),
    participantNames: Array.from({ length: 8 }, (_, i) => `Persona ${i + 3}`)
  });
  assert.equal(bookRes2.status, 201);

  // Week 1 Monday is now sold out (0 seats, status soldout)
  const availRes3 = await request(`/api/availability?tour=${tourId}&days=14&from=2026-11-30`);
  const { daysList: daysList3 } = await availRes3.json();
  const w1MonSoldout = daysList3.find(d => d.date === '2026-11-30').tours.find(t => t.tourId === tourId).departures[0];
  assert.equal(w1MonSoldout.left, 0);
  assert.equal(w1MonSoldout.status, 'soldout');

  // Attempting to book Week 1 Monday rejected with 409 sold_out
  const overbookRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2026-11-30',
    time: '10:00',
    participants: 1,
    customer: customer('Rechazado'),
    participantNames: ['Rechazado']
  });
  assert.equal(overbookRes.status, 409);
  const overbookJson = await overbookRes.json();
  assert.equal(overbookJson.error.code, 'sold_out');

  // User can select the following week: Booking Week 2 Monday succeeds cleanly
  const bookWeek2 = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2026-12-07',
    time: '10:00',
    participants: 4,
    customer: customer('Semana Siguiente'),
    participantNames: Array.from({ length: 4 }, (_, i) => `Turista Sig ${i + 1}`)
  });
  assert.equal(bookWeek2.status, 201);

  // 5. Backend validations:
  // Rejects booking on a non-operating weekday (e.g. Wednesday 2026-12-02) -> 422 unavailable
  const nonOperatingRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2026-12-02',
    time: '10:00',
    participants: 1,
    customer: customer('No Opera'),
    participantNames: ['No Opera']
  });
  assert.equal(nonOperatingRes.status, 422);
  const nonOpJson = await nonOperatingRes.json();
  assert.equal(nonOpJson.error.code, 'unavailable');

  // Rejects booking on past date -> 409 past
  const pastRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: crypto.randomUUID(),
    tourId,
    date: '2020-01-06',
    time: '10:00',
    participants: 1,
    customer: customer('Pasado'),
    participantNames: ['Pasado']
  });
  assert.equal(pastRes.status, 409);
  const pastJson = await pastRes.json();
  assert.equal(pastJson.error.code, 'past');

  // 6. 20-minute hold release:
  // Expire the hold of the 8 participants on Week 1 Monday
  await database.transaction((unit) => {
    const r2 = unit.document.reservations.find(r => r.participants === 8 && r.tourId === tourId);
    if (r2) {
      r2.holdExpiresAt = new Date(Date.now() - 60000).toISOString();
    }
    unit.dirty = true;
  });

  // Now querying Week 1 Monday shows 8 seats freed (left: 8, from initial 2 held)
  const availResRestored = await request(`/api/availability?tour=${tourId}&days=14&from=2026-11-30`);
  const { daysList: daysListRestored } = await availResRestored.json();
  const w1MonRestored = daysListRestored.find(d => d.date === '2026-11-30').tours.find(t => t.tourId === tourId).departures[0];
  assert.equal(w1MonRestored.left, 8, 'Hold release restores the 8 seats on Week 1 Monday');
  assert.equal(w1MonRestored.status, 'open');
});
