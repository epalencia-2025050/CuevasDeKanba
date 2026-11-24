import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createConfig, withRuntime } from '../server/runtime.js';
import { createInitialStore } from '../server/store.js';
import { memoryRepository } from './helpers/memory-repository.mjs';

const TEST_CAFE_PRODUCTS = [
  { id: 'gallo-grande', name: 'Gallo Grande', category: 'Cervezas', price: 25, cost: 14, stock: 50, minStock: 10, unit: 'botella', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'gallo-pequena-corona', name: 'Gallo Pequeña y Corona', category: 'Cervezas', price: 20, cost: 11, stock: 45, minStock: 10, unit: 'botella', active: true, variants: ['Gallo Pequeña', 'Corona'], createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'gaseosas', name: 'Gaseosas', category: 'Bebidas sin alcohol', price: 10, cost: 5, stock: 60, minStock: 15, unit: 'lata', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'agua-pura', name: 'Agua pura', category: 'Bebidas sin alcohol', price: 10, cost: 4, stock: 80, minStock: 20, unit: 'botella', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ice-te', name: 'Ice Té', category: 'Bebidas sin alcohol', price: 15, cost: 7, stock: 40, minStock: 10, unit: 'vaso', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cafe', name: 'Café', category: 'Bebidas sin alcohol', price: 10, cost: 4, stock: 100, minStock: 25, unit: 'taza', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'te', name: 'Té', category: 'Bebidas sin alcohol', price: 10, cost: 3, stock: 50, minStock: 15, unit: 'taza', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tequila', name: 'Tequila', category: 'Licores', price: 10, cost: 5, stock: 30, minStock: 8, unit: 'shot', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ron', name: 'Ron', category: 'Licores', price: 15, cost: 7, stock: 35, minStock: 8, unit: 'trago', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cuba-libre', name: 'Cuba libre', category: 'Licores', price: 20, cost: 9, stock: 30, minStock: 8, unit: 'vaso', active: true, createdAt: '2026-01-01T00:00:00.000Z' }
];

const TEST_CAFE_SUPPLIES = [
  { id: 'sup-cafe-grano', name: 'Café en grano Alta Verapaz', category: 'Insumos de cocina', stock: 15, minStock: 5, unit: 'lb', cost: 35, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'sup-azucar', name: 'Azúcar morena', category: 'Insumos de cocina', stock: 20, minStock: 5, unit: 'lb', cost: 6, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'sup-vasos', name: 'Vasos biodegradables 12oz', category: 'Empaques y desechables', stock: 200, minStock: 50, unit: 'unidad', cost: 0.75, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'sup-servilletas', name: 'Servilletas de papel', category: 'Empaques y desechables', stock: 500, minStock: 100, unit: 'unidad', cost: 0.08, active: true, createdAt: '2026-01-01T00:00:00.000Z' }
];

function setup({ seed = true } = {}) {
  const config = createConfig({
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://kanba.test',
    ADMIN_PASSWORD: 'synthetic-password',
    GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic'
  });
  const initial = withRuntime({ config }, createInitialStore);
  if (seed) {
    initial.cafeProducts = TEST_CAFE_PRODUCTS.map((p) => ({ ...p }));
    initial.cafeSupplies = TEST_CAFE_SUPPLIES.map((s) => ({ ...s }));
  }
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
    const response = await request('/api/auth/login', '', 'POST', {
      email: `${role}@example.invalid`,
      password: 'synthetic-password',
      role: 'admin'
    });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().find((c) => c.startsWith('kanba_user=')).split(';')[0];
  }

  return { request, login, database };
}

test('cafeteria: empty database returns empty menu, catalog, inventory and reports without fallback seeds', async () => {
  const { request, login } = setup({ seed: false });
  const adminCookie = await login('admin');

  // 1. Menu endpoint with empty DB
  const menuRes = await request('/api/cafe/menu');
  assert.equal(menuRes.status, 200);
  const menu = await menuRes.json();
  assert.equal(menu.ok, true);
  assert.deepEqual(menu.items, []);
  assert.deepEqual(menu.categories, []);

  // 2. Admin products
  const prodRes = await request('/api/admin/cafe/products', adminCookie);
  assert.equal(prodRes.status, 200);
  assert.deepEqual((await prodRes.json()).products, []);

  // 3. Admin inventory
  const invRes = await request('/api/admin/cafe/inventory', adminCookie);
  assert.equal(invRes.status, 200);
  const inv = await invRes.json();
  assert.deepEqual(inv.products, []);
  assert.deepEqual(inv.supplies, []);

  // 4. Admin sales
  const salesRes = await request('/api/admin/cafe/sales', adminCookie);
  assert.equal(salesRes.status, 200);
  assert.deepEqual((await salesRes.json()).sales, []);

  // 5. Admin expenses
  const expRes = await request('/api/admin/cafe/expenses', adminCookie);
  assert.equal(expRes.status, 200);
  const exp = await expRes.json();
  assert.deepEqual(exp.expenses, []);

  // 6. Admin reports
  const repRes = await request('/api/admin/cafe/reports', adminCookie);
  assert.equal(repRes.status, 200);
  const rep = await repRes.json();
  assert.equal(rep.summary.totalIncome, 0);
  assert.equal(rep.summary.totalExpenses, 0);
  assert.equal(rep.summary.netProfit, 0);
  assert.equal(rep.summary.salesCount, 0);
  assert.deepEqual(rep.topProducts, []);
  assert.equal(rep.inventorySummary.totalProducts, 0);
  assert.equal(rep.inventorySummary.totalSupplies, 0);
});

test('cafeteria: public menu serves active products and supports online ordering with stock deduction', async () => {
  const { request, database } = setup();

  // 1. Menu endpoint
  const menuRes = await request('/api/cafe/menu');
  assert.equal(menuRes.status, 200);
  const menu = await menuRes.json();
  assert.equal(menu.ok, true);
  assert(Array.isArray(menu.items));
  assert(menu.items.length >= 10);

  const cafeProd = menu.items.find((p) => p.id === 'cafe');
  assert(cafeProd);
  const initialStock = cafeProd.stock;

  // 2. Order online with card
  const orderRes = await request('/api/cafe/orders', '', 'POST', {
    items: [{ id: 'cafe', quantity: 2 }],
    customer: {
      name: 'Carlos Test',
      email: 'carlos@example.com',
      phone: '+502 1234 5678',
      serviceType: 'En mesa · Cafetería',
      notes: 'Mesa 5'
    },
    card: {
      number: '4242 4242 4242 4242',
      name: 'Carlos Test',
      expiry: '12/28',
      cvc: '123'
    }
  });

  assert.equal(orderRes.status, 201);
  const { order } = await orderRes.json();
  assert(order.code.startsWith('CAFE-'));
  assert(order.receipt?.number?.startsWith('REC-'));
  assert.equal(order.total, 20); // 10 * 2 = 20
  assert.equal(order.payment?.method, 'card');

  // Verify inventory deduction in store
  await database.transaction(async (unit) => {
    const updatedProd = unit.document.cafeProducts.find((p) => p.id === 'cafe');
    assert.equal(updatedProd.stock, initialStock - 2);

    const mov = unit.document.cafeInventoryMovements.find((m) => m.reference === order.code);
    assert(mov);
    assert.equal(mov.movementType, 'sale');
    assert.equal(mov.quantity, -2);
  });

  // 3. Order online with cash (no card required)
  const cashOrderRes = await request('/api/cafe/orders', '', 'POST', {
    paymentMethod: 'cash',
    items: [{ id: 'cafe', quantity: 1 }],
    customer: {
      name: 'Lucía Efectivo',
      phone: '+502 9876 5432',
      serviceType: 'Para llevar'
    }
  });

  assert.equal(cashOrderRes.status, 201);
  const { order: cashOrder } = await cashOrderRes.json();
  assert(cashOrder.code.startsWith('CAFE-'));
  assert.equal(cashOrder.payment?.method, 'cash');
  assert.equal(cashOrder.payment?.brand, 'Efectivo');
  assert.equal(cashOrder.customer.notes, '');
  assert.notEqual(cashOrder.customer.notes, 'null');
});

test('cafeteria: admin security guards require admin role', async () => {
  const { request, login } = setup();
  const userCookie = await login('user');

  for (const ep of [
    '/api/admin/cafe/products',
    '/api/admin/cafe/inventory',
    '/api/admin/cafe/sales',
    '/api/admin/cafe/expenses',
    '/api/admin/cafe/reports'
  ]) {
    assert.equal((await request(ep)).status, 401);
    assert.equal((await request(ep, userCookie)).status, 403);
  }
});

test('cafeteria: products CRUD and stock adjustment kardex', async () => {
  const { request, login, database } = setup();
  const adminCookie = await login('admin');

  // Create product
  const createRes = await request('/api/admin/cafe/products', adminCookie, 'POST', {
    name: 'Pastel de Chocolate',
    category: 'Postres',
    price: 25,
    cost: 12,
    stock: 15,
    minStock: 4,
    unit: 'porción'
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).product;
  assert.equal(created.name, 'Pastel de Chocolate');
  assert.equal(created.price, 25);
  assert.equal(created.stock, 15);
  assert.deepEqual(created.variants, []);

  // Update product stock and price
  const updateRes = await request(`/api/admin/cafe/products/${created.id}`, adminCookie, 'PUT', {
    price: 28,
    stock: 20
  });
  assert.equal(updateRes.status, 200);
  const updated = (await updateRes.json()).product;
  assert.equal(updated.price, 28);
  assert.equal(updated.stock, 20);

  // Check Kardex has the adjustment movement
  await database.transaction(async (unit) => {
    const mov = unit.document.cafeInventoryMovements.find(
      (m) => m.itemId === created.id && m.movementType === 'adjustment'
    );
    assert(mov);
    assert.equal(mov.quantity, 5); // 20 - 15 = 5
  });

  // Archive / Delete product
  const delRes = await request(`/api/admin/cafe/products/${created.id}`, adminCookie, 'DELETE', {});
  assert.equal(delRes.status, 200);
});

test('cafeteria: admin POS sale automatically generates receipt and logs inventory movement', async () => {
  const { request, login, database } = setup();
  const adminCookie = await login('admin');

  // Find product stock before POS sale
  let initialGalloStock = 0;
  await database.transaction(async (unit) => {
    const prod = unit.document.cafeProducts.find((p) => p.id === 'gallo-grande');
    initialGalloStock = prod.stock;
  });

  // Register POS sale
  const saleRes = await request('/api/admin/cafe/sales', adminCookie, 'POST', {
    items: [{ id: 'gallo-grande', quantity: 3 }],
    paymentMethod: 'cash',
    customer: {
      name: 'Mario Barra',
      serviceType: 'En barra',
      notes: 'Cobro en efectivo'
    }
  });

  assert.equal(saleRes.status, 201);
  const { order } = await saleRes.json();
  assert(order.code.startsWith('CAFE-'));
  assert(order.receipt?.number?.startsWith('REC-'));
  assert.equal(order.payment?.method, 'cash');
  assert.equal(order.total, 75); // 25 * 3 = 75

  // Verify stock deduction
  await database.transaction(async (unit) => {
    const prod = unit.document.cafeProducts.find((p) => p.id === 'gallo-grande');
    assert.equal(prod.stock, initialGalloStock - 3);

    const mov = unit.document.cafeInventoryMovements.find(
      (m) => m.reference === order.code && m.movementType === 'sale'
    );
    assert(mov);
    assert.equal(mov.quantity, -3);
  });
});

test('cafeteria: inventory manual movements (in, out, adjustment) enforce stock validity', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // Manual IN
  const inRes = await request('/api/admin/cafe/inventory/movements', adminCookie, 'POST', {
    itemType: 'product',
    itemId: 'agua-pura',
    movementType: 'in',
    quantity: 10,
    reason: 'Compra de garrafones y botellas'
  });
  assert.equal(inRes.status, 201);

  // Manual OUT
  const outRes = await request('/api/admin/cafe/inventory/movements', adminCookie, 'POST', {
    itemType: 'product',
    itemId: 'agua-pura',
    movementType: 'out',
    quantity: 2,
    reason: 'Merma por rotura de envase'
  });
  assert.equal(outRes.status, 201);

  // Manual OUT exceeding stock fails gracefully
  const failRes = await request('/api/admin/cafe/inventory/movements', adminCookie, 'POST', {
    itemType: 'product',
    itemId: 'agua-pura',
    movementType: 'out',
    quantity: 99999,
    reason: 'Salida masiva imposible'
  });
  assert.equal(failRes.status, 422);

  // Kardex history query
  const kardexRes = await request('/api/admin/cafe/inventory/movements?itemId=agua-pura', adminCookie);
  assert.equal(kardexRes.status, 200);
  const { movements } = await kardexRes.json();
  assert(movements.length >= 2);
});

test('cafeteria: operational expenses registration, filtering and periodic reports', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // Create expense
  const expRes = await request('/api/admin/cafe/expenses', adminCookie, 'POST', {
    concept: 'Compra de 10 lbs café en grano y vasos',
    category: 'insumos',
    amount: 350.5,
    expenseDate: '2026-11-20',
    notes: 'Distribuidora Alta Verapaz'
  });
  assert.equal(expRes.status, 201);
  const { expense } = await expRes.json();
  assert(expense.id.startsWith('EXP-'));
  assert.equal(expense.amount, 350.5);

  // Query expenses with filter
  const listRes = await request('/api/admin/cafe/expenses?category=insumos', adminCookie);
  assert.equal(listRes.status, 200);
  const { expenses } = await listRes.json();
  assert(expenses.some((e) => e.id === expense.id));

  // Reports endpoint
  const reportRes = await request('/api/admin/cafe/reports?from=2026-11-01&to=2026-11-30', adminCookie);
  assert.equal(reportRes.status, 200);
  const report = await reportRes.json();
  assert.equal(report.ok, true);
  assert('totalIncome' in report.summary);
  assert('totalExpenses' in report.summary);
  assert('netProfit' in report.summary);
  assert(Array.isArray(report.topProducts));
  assert(report.expensesByCategory.insumos >= 350.5);
});

test('cafeteria: export reports to Excel (CSV with BOM) and printable HTML/PDF', async () => {
  const { request, login } = setup();
  const adminCookie = await login('admin');

  // CSV Summary export
  const csvRes = await request('/api/admin/cafe/reports/export?format=csv&type=summary&from=2026-01-01&to=2026-12-31', adminCookie);
  assert.equal(csvRes.status, 200);
  assert.equal(csvRes.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert(csvRes.headers.get('content-disposition').includes('.csv'));
  const csvBuffer = Buffer.from(await csvRes.arrayBuffer());
  assert.equal(csvBuffer[0], 0xEF);
  assert.equal(csvBuffer[1], 0xBB);
  assert.equal(csvBuffer[2], 0xBF);
  const csvText = csvBuffer.toString('utf-8');
  assert(csvText.includes('REPORTE FINANCIERO Y OPERATIVO'));

  // CSV Sales export
  const salesCsvRes = await request('/api/admin/cafe/reports/export?format=csv&type=sales', adminCookie);
  assert.equal(salesCsvRes.status, 200);
  const salesBuffer = Buffer.from(await salesCsvRes.arrayBuffer());
  assert.equal(salesBuffer[0], 0xEF);
  assert.equal(salesBuffer[1], 0xBB);
  assert.equal(salesBuffer[2], 0xBF);
  const salesCsvText = salesBuffer.toString('utf-8');
  assert(salesCsvText.includes('Código,Comprobante'));

  // CSV Inventory export
  const invCsvRes = await request('/api/admin/cafe/reports/export?format=csv&type=inventory', adminCookie);
  assert.equal(invCsvRes.status, 200);
  const invBuffer = Buffer.from(await invCsvRes.arrayBuffer());
  assert.equal(invBuffer[0], 0xEF);
  assert.equal(invBuffer[1], 0xBB);
  assert.equal(invBuffer[2], 0xBF);
  const invCsvText = invBuffer.toString('utf-8');
  assert(invCsvText.includes('Stock Actual,Stock Mínimo'));

  // HTML / PDF printable report export
  const htmlRes = await request('/api/admin/cafe/reports/export?format=html&from=2026-01-01&to=2026-12-31', adminCookie);
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get('content-type'), 'text/html; charset=utf-8');
  const htmlText = await htmlRes.text();
  assert(htmlText.includes('Café The Hope · K’anba Cuevas Vivas'));
  assert(htmlText.includes('@media print'));
  assert(htmlText.includes('window.print()'));
});
