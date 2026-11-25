import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

function setup() {
  const config = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password',
    GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic'
  });
  const initial = withRuntime({ config }, createInitialStore);

  initial.tours = [
    {
      id: 'cueva-rio-sagrado',
      name: 'Cueva Río Sagrado',
      price: 150,
      capacity: 20,
      maxParticipants: 20,
      durationMinutes: 120,
      days: [0, 1, 2, 3, 4, 5, 6],
      includes: ['Linterna', 'Guía'],
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      startTime: '09:00',
      endTime: '17:00',
      times: ['09:00', '10:00', '14:00'],
      active: true
    }
  ];

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
    assets: async () => new Response('protected HTML')
  };
  const app = createApp(services);
  const request = (path, cookie = '', method = 'GET', body) =>
    app.request(config.PUBLIC_URL + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: config.PUBLIC_URL,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });

  async function login(role) {
    const res = await request('/api/auth/login', '', 'POST', {
      email: `${role}@example.invalid`,
      password: 'synthetic-password'
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie') || '';
  }

  return { app, request, login, database };
}

test('tours: guides CRUD and reservation assignment', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');
  const userCookie = await login('user');

  // Forbidden to non-admin
  const forbiddenRes = await request('/api/admin/guides', userCookie);
  assert.equal(forbiddenRes.status, 403);

  // List initial guides (empty)
  const listRes = await request('/api/admin/guides', adminCookie);
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.deepEqual(listJson.guides, []);

  // Create guide
  const createRes = await request('/api/admin/guides', adminCookie, 'POST', {
    name: 'Pedro Che',
    phone: '+502 5555-1234',
    languages: ['Español', "Q'eqchi'", 'Inglés'],
    active: true
  });
  assert.equal(createRes.status, 201);
  const createJson = await createRes.json();
  assert.ok(createJson.guide.id);
  assert.equal(createJson.guide.name, 'Pedro Che');
  assert.equal(createJson.guide.active, true);
  const guideId = createJson.guide.id;

  // Update guide
  const updateRes = await request(`/api/admin/guides/${guideId}`, adminCookie, 'PUT', {
    name: 'Pedro Che Pop',
    phone: '+502 5555-9999',
    languages: ['Español', "Q'eqchi'", 'Inglés', 'Francés'],
    active: true
  });
  assert.equal(updateRes.status, 200);
  const updateJson = await updateRes.json();
  assert.equal(updateJson.guide.name, 'Pedro Che Pop');
  assert.equal(updateJson.guide.languages.length, 4);

  // Create a walk-in sale to test guide assignment
  const saleRes = await request('/api/admin/tours/pos/sale', adminCookie, 'POST', {
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-15',
    time: '09:00',
    participants: 2,
    customerName: 'Turista Aventura',
    paymentMethod: 'cash'
  });
  assert.equal(saleRes.status, 201);
  const saleJson = await saleRes.json();
  const code = saleJson.reservation.code;
  assert.ok(code);

  // Assign guide to reservation
  const assignRes = await request(`/api/admin/reservations/${code}/guide`, adminCookie, 'PATCH', {
    guideId
  });
  assert.equal(assignRes.status, 200);
  const assignJson = await assignRes.json();
  assert.equal(assignJson.reservation.guideId, guideId);
  assert.equal(assignJson.reservation.guideName, 'Pedro Che Pop');

  // Check reservation details include guide
  const detailRes = await request(`/api/admin/reservations/${code}`, adminCookie);
  assert.equal(detailRes.status, 200);
  const detailJson = await detailRes.json();
  assert.equal(detailJson.reservation.guideId, guideId);
  assert.equal(detailJson.reservation.guideName, 'Pedro Che Pop');

  // Deactivate or delete guide
  const delRes = await request(`/api/admin/guides/${guideId}`, adminCookie, 'DELETE');
  assert.equal(delRes.status, 200);
  const delJson = await delRes.json();
  assert.equal(delJson.ok, true);
});

test('tours: taquilla POS walk-in sale immediately deducts shared capacity and generates ticket', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // Check initial availability for tour 'cueva-rio-sagrado' on 2026-12-15
  const availRes1 = await request('/api/availability?tour=cueva-rio-sagrado&from=2026-12-15&days=1');
  assert.equal(availRes1.status, 200);
  const availJson1 = await availRes1.json();
  const day1 = availJson1.daysList.find((d) => d.date === '2026-12-15');
  assert.ok(day1);
  const departure1 = day1.tours[0].departures.find((d) => d.time === '09:00');
  assert.ok(departure1);
  assert.equal(departure1.taken, 0);

  // Perform walk-in POS sale of 3 participants
  const saleRes = await request('/api/admin/tours/pos/sale', adminCookie, 'POST', {
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-15',
    time: '09:00',
    participants: 3,
    customerName: 'Familia Ramírez',
    customerPhone: '+502 4444-5555',
    customerEmail: 'ramirez@ejemplo.com',
    paymentMethod: 'card'
  });
  assert.equal(saleRes.status, 201);
  const saleJson = await saleRes.json();
  assert.equal(saleJson.ok, true);
  assert.equal(saleJson.reservation.channel, 'pos');
  assert.equal(saleJson.reservation.status, 'confirmed');
  assert.equal(saleJson.reservation.participants, 3);
  assert.ok(saleJson.reservation.receipt?.number);
  assert.ok(saleJson.ticketUrl);

  // Shared capacity on the web is immediately reduced: taken is now 3
  const availRes2 = await request('/api/availability?tour=cueva-rio-sagrado&from=2026-12-15&days=1');
  const availJson2 = await availRes2.json();
  const day2 = availJson2.daysList.find((d) => d.date === '2026-12-15');
  const departure2 = day2.tours[0].departures.find((d) => d.time === '09:00');
  assert.equal(departure2.taken, 3);

  // Printable ticket endpoint returns HTML with ticket details
  const ticketRes = await request(`/api/admin/reservations/${saleJson.reservation.code}/ticket`, adminCookie);
  assert.equal(ticketRes.status, 200);
  assert.equal(ticketRes.headers.get('content-type'), 'text/html; charset=utf-8');
  const ticketHtml = await ticketRes.text();
  assert.ok(ticketHtml.includes(saleJson.reservation.code));
  assert.ok(ticketHtml.includes('Familia Ramírez'));
  assert.ok(ticketHtml.includes('3 persona(s)'));

  // Oversell attempt rejected
  const oversellRes = await request('/api/admin/tours/pos/sale', adminCookie, 'POST', {
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-15',
    time: '09:00',
    participants: 50, // exceeds capacity
    customerName: 'Grupo Enorme'
  });
  assert.equal(oversellRes.status, 422); // exceeds maxParticipants or 409 sold_out
});

test('tours: operational expenses registration, filtering and classification', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // Register expenses
  const exp1 = await request('/api/admin/tours/expenses', adminCookie, 'POST', {
    expenseDate: '2026-12-10',
    concept: 'Baterías y repuestos para linternas acuáticas',
    category: 'equipo',
    amount: 350.5,
    notes: 'Compra en ferretería central'
  });
  assert.equal(exp1.status, 201);
  const json1 = await exp1.json();
  assert.equal(json1.expense.category, 'equipo');
  assert.equal(json1.expense.amount, 350.5);

  const exp2 = await request('/api/admin/tours/expenses', adminCookie, 'POST', {
    expenseDate: '2026-12-12',
    concept: 'Honorarios guía fin de semana',
    category: 'guias',
    amount: 500,
    notes: 'Pago a guía auxiliar'
  });
  assert.equal(exp2.status, 201);
  const json2 = await exp2.json();
  const exp2Id = json2.expense.id;

  // Filter by category
  const filterCatRes = await request('/api/admin/tours/expenses?category=guias', adminCookie);
  assert.equal(filterCatRes.status, 200);
  const filterCatJson = await filterCatRes.json();
  assert.equal(filterCatJson.expenses.length, 1);
  assert.equal(filterCatJson.total, 500);

  // Filter by date range
  const filterDateRes = await request('/api/admin/tours/expenses?from=2026-12-11&to=2026-12-13', adminCookie);
  assert.equal(filterDateRes.status, 200);
  const filterDateJson = await filterDateRes.json();
  assert.equal(filterDateJson.expenses.length, 1);
  assert.equal(filterDateJson.expenses[0].id, exp2Id);

  // Delete expense
  const delRes = await request(`/api/admin/tours/expenses/${exp2Id}`, adminCookie, 'DELETE');
  assert.equal(delRes.status, 200);
  const afterDelRes = await request('/api/admin/tours/expenses', adminCookie);
  const afterDelJson = await afterDelRes.json();
  assert.equal(afterDelJson.expenses.length, 1);
  assert.equal(afterDelJson.total, 350.5);
});

test('tours: reports and exports (Excel CSV with UTF-8 BOM and printable PDF)', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // Record a POS sale
  await request('/api/admin/tours/pos/sale', adminCookie, 'POST', {
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-20',
    time: '10:00',
    participants: 4,
    customerName: 'Grupo Caminantes',
    paymentMethod: 'cash'
  });

  // Record an operational expense
  await request('/api/admin/tours/expenses', adminCookie, 'POST', {
    expenseDate: '2026-12-20',
    concept: 'Mantenimiento de cuerdas y peldaños de cueva',
    category: 'mantenimiento',
    amount: 250,
    notes: 'Reemplazo de peldaño dañado'
  });

  // Query reports
  const repRes = await request('/api/admin/tours/reports?from=2026-12-01&to=2026-12-31', adminCookie);
  assert.equal(repRes.status, 200);
  const repJson = await repRes.json();
  assert.ok(repJson.summary.totalRevenue > 0);
  assert.equal(repJson.summary.totalBookings, 1);
  assert.equal(repJson.summary.totalParticipants, 4);
  assert.equal(repJson.summary.totalExpenses, 250);
  assert.ok(repJson.summary.netProfit > 0);
  assert.equal(repJson.channels.pos.bookings, 1);
  assert.equal(repJson.channels.pos.participants, 4);
  assert.equal(repJson.toursRanking.length, 1);

  // Export to Excel (CSV with UTF-8 BOM)
  const csvRes = await request('/api/admin/tours/reports/export?format=csv&from=2026-12-01&to=2026-12-31', adminCookie);
  assert.equal(csvRes.status, 200);
  assert.equal(csvRes.headers.get('content-type'), 'text/csv; charset=utf-8');
  const csvBuffer = await csvRes.arrayBuffer();
  const csvBytes = new Uint8Array(csvBuffer);
  // Verify UTF-8 BOM: 0xEF, 0xBB, 0xBF
  assert.equal(csvBytes[0], 0xef);
  assert.equal(csvBytes[1], 0xbb);
  assert.equal(csvBytes[2], 0xbf);
  const csvText = new TextDecoder('utf-8').decode(csvBytes);
  assert.ok(csvText.includes('REPORTE OPERATIVO Y COMERCIAL DE TOURS'));
  assert.ok(csvText.includes('Grupo Caminantes'));
  assert.ok(csvText.includes('Mantenimiento de cuerdas y peldaños de cueva'));

  // Export to PDF / HTML printable view
  const pdfRes = await request('/api/admin/tours/reports/export?format=pdf&from=2026-12-01&to=2026-12-31', adminCookie);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'text/html; charset=utf-8');
  const pdfHtml = await pdfRes.text();
  assert.ok(pdfHtml.includes('Reporte Operativo y Comercial'));
  assert.ok(pdfHtml.includes('Grupo Caminantes'));
});

test('tour booking: guide group booking records tourists count and agency, validates capacity and shows in admin', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');
  const userCookie = await login('user');

  // 1. Normal reservation without guideGroup
  const normalRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: 'req_normal_guide_test_001',
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-25',
    time: '10:00',
    participants: 2,
    participantNames: ['Visitante Uno', 'Visitante Dos'],
    customer: {
      name: 'Viajero Normal',
      email: 'viajero@example.invalid',
      phone: '55551111',
      country: 'Guatemala',
      acceptPolicies: true,
      acceptTerms: true
    }
  });
  assert.equal(normalRes.status, 201);
  const normalJson = await normalRes.json();
  assert.ok(normalJson.code);
  assert.equal(normalJson.guideGroup, undefined);

  // 2. Guide reservation with 5 tourists and agency
  const guideRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: 'req_guide_group_test_002',
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-25',
    time: '10:00',
    participants: 5,
    participantNames: ['Turista 1', 'Turista 2', 'Turista 3', 'Turista 4', 'Turista 5'],
    customer: {
      name: 'Guía Carlos Pop',
      email: 'guia.carlos@example.invalid',
      phone: '55552222',
      country: 'Guatemala',
      acceptPolicies: true,
      acceptTerms: true
    },
    guideGroup: {
      isGuide: true,
      tourists: 5,
      agency: 'Rutas Kanba Aventura'
    }
  });
  assert.equal(guideRes.status, 201);
  const guideJson = await guideRes.json();
  assert.ok(guideJson.code);
  assert.equal(guideJson.guideGroup?.isGuide, true);
  assert.equal(guideJson.guideGroup?.tourists, 5);
  assert.equal(guideJson.guideGroup?.agency, 'Rutas Kanba Aventura');

  // Check departure availability: initial capacity 20 - 2 (normal) - 5 (guide) = 13 left
  const availRes = await request('/api/availability?tour=cueva-rio-sagrado&from=2026-12-25&days=1');
  assert.equal(availRes.status, 200);
  const availJson = await availRes.json();
  const dep = availJson.daysList?.[0]?.tours?.[0]?.departures?.find((d) => d.time === '10:00');
  assert.ok(dep);
  assert.equal(dep.taken, 7);
  assert.equal(dep.left, 13);

  // 3. Exceeding capacity check: requesting 14 seats when only 13 are left should fail with 409
  const overbookRes = await request('/api/reservations', userCookie, 'POST', {
    requestId: 'req_guide_group_overbook_003',
    tourId: 'cueva-rio-sagrado',
    date: '2026-12-25',
    time: '10:00',
    participants: 14,
    participantNames: Array.from({ length: 14 }, (_, i) => `Turista ${i + 1}`),
    customer: {
      name: 'Otro Guía',
      email: 'guia2@example.invalid',
      phone: '55553333',
      country: 'Guatemala',
      acceptPolicies: true,
      acceptTerms: true
    },
    guideGroup: {
      isGuide: true,
      tourists: 14,
      agency: 'Tour Operador Exceso'
    }
  });
  assert.equal(overbookRes.status, 409);

  // 4. Admin search and detail verification
  const searchAgencyRes = await request('/api/admin/reservations?q=Kanba+Aventura', adminCookie);
  assert.equal(searchAgencyRes.status, 200);
  const searchJson = await searchAgencyRes.json();
  assert.equal(searchJson.total, 1);
  assert.equal(searchJson.reservations[0].code, guideJson.code);
  assert.equal(searchJson.reservations[0].guideGroup?.agency, 'Rutas Kanba Aventura');
  assert.equal(searchJson.reservations[0].guideGroup?.tourists, 5);

  const detailRes = await request(`/api/admin/reservations/${guideJson.code}`, adminCookie);
  assert.equal(detailRes.status, 200);
  const detailJson = await detailRes.json();
  assert.equal(detailJson.reservation.guideGroup?.isGuide, true);
  assert.equal(detailJson.reservation.guideGroup?.tourists, 5);
  assert.equal(detailJson.reservation.guideGroup?.agency, 'Rutas Kanba Aventura');

  // Normal reservation detail in admin should not have guideGroup
  const normalDetailRes = await request(`/api/admin/reservations/${normalJson.code}`, adminCookie);
  assert.equal(normalDetailRes.status, 200);
  const normalDetailJson = await normalDetailRes.json();
  assert.equal(normalDetailJson.reservation.guideGroup, undefined);

  // 5. Dedicated guide groups endpoint and status synchronization
  const nonAdminGroupsRes = await request('/api/admin/tours/guide-groups', userCookie);
  assert.equal(nonAdminGroupsRes.status, 403, 'Acceso denegado a usuarios no administradores');

  const adminGroupsRes = await request('/api/admin/tours/guide-groups?q=Kanba+Aventura', adminCookie);
  assert.equal(adminGroupsRes.status, 200);
  const adminGroupsJson = await adminGroupsRes.json();
  assert.equal(adminGroupsJson.ok, true);
  assert.equal(adminGroupsJson.total, 1);
  const groupRecord = adminGroupsJson.guideGroups[0];
  assert.equal(groupRecord.reservationCode, guideJson.code);
  assert.equal(groupRecord.tourId, 'cueva-rio-sagrado');
  assert.equal(groupRecord.date, '2026-12-25');
  assert.equal(groupRecord.time, '10:00');
  assert.equal(groupRecord.touristsCount, 5);
  assert.equal(groupRecord.agencyName, 'Rutas Kanba Aventura');
  assert.equal(groupRecord.status, 'pending_payment');

  // Cancel reservation and verify status synchronization in dedicated guide group record
  const cancelRes = await request(`/api/admin/reservations/${guideJson.code}/cancel`, adminCookie, 'POST', {
    reason: 'Cancelado por solicitud del guía'
  });
  assert.equal(cancelRes.status, 200);

  const updatedGroupsRes = await request(`/api/admin/tours/guide-groups?tourId=cueva-rio-sagrado`, adminCookie);
  assert.equal(updatedGroupsRes.status, 200);
  const updatedGroupsJson = await updatedGroupsRes.json();
  assert.equal(updatedGroupsJson.total, 1);
  assert.equal(updatedGroupsJson.guideGroups[0].status, 'cancelled');
});
