const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOperationsResponse,
  closeInactiveOperations,
  listOperationDays,
  processTelemetryForOperations
} = require('../operations');
const { createEmptyStore, migrateStoreData } = require('../store');

function createRuntimeStore() {
  const store = createEmptyStore();
  store.companies.push({ id: '1', name: 'Demo' });
  return store;
}

test('contabiliza um voo apenas uma vez e fecha após 30 minutos de inatividade', () => {
  const store = createRuntimeStore();
  const startedAt = Date.UTC(2026, 5, 24, 10, 0, 0);

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS391',
    droneId: 'AGRAS391',
    companyId: '1',
    telemetry: { altitude: 0, hectaresApplied: 10.0 },
    telemetryAtMs: startedAt
  });

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS391',
    droneId: 'AGRAS391',
    companyId: '1',
    telemetry: { altitude: 2.5, hectaresApplied: 10.2 },
    telemetryAtMs: startedAt + 1000
  });

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS391',
    droneId: 'AGRAS391',
    companyId: '1',
    telemetry: { altitude: 2.5, hectaresApplied: 10.2 },
    telemetryAtMs: startedAt + 2000
  });

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS391',
    droneId: 'AGRAS391',
    companyId: '1',
    telemetry: { altitude: 0, hectaresApplied: 10.8 },
    telemetryAtMs: startedAt + 10 * 60 * 1000
  });

  assert.equal(store.operations.length, 1);
  assert.equal(store.operations[0].totalFlights, 1);
  assert.equal(store.operations[0].status, 'OPEN');

  const changed = closeInactiveOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    nowMs: startedAt + 41 * 60 * 1000
  });

  assert.equal(changed, true);
  assert.equal(store.operations[0].status, 'CLOSED');
  assert.equal(store.operations[0].hectaresWorked, 0.8);
  assert.equal(store.operations[0].totalOperationMs, 10 * 60 * 1000);
});

test('cria múltiplas operações no mesmo dia e consolida o resumo diário', () => {
  const store = createRuntimeStore();
  const base = Date.UTC(2026, 5, 24, 7, 0, 0);

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS382',
    droneId: '382',
    companyId: '1',
    telemetry: { altitude: 3, hectaresApplied: 0.0 },
    telemetryAtMs: base,
    pilotName: 'Gabriel',
    farmName: 'Alianca'
  });
  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS382',
    droneId: '382',
    companyId: '1',
    telemetry: { altitude: 0, hectaresApplied: 12.5 },
    telemetryAtMs: base + 4 * 60 * 60 * 1000
  });
  closeInactiveOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    nowMs: base + 4 * 60 * 60 * 1000 + 31 * 60 * 1000
  });

  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS382',
    droneId: '382',
    companyId: '1',
    telemetry: { altitude: 3, hectaresApplied: 12.5 },
    telemetryAtMs: base + 7 * 60 * 60 * 1000
  });
  processTelemetryForOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    droneCode: 'AGRAS382',
    droneId: '382',
    companyId: '1',
    telemetry: { altitude: 0, hectaresApplied: 30.8 },
    telemetryAtMs: base + 11 * 60 * 60 * 1000
  });
  closeInactiveOperations({
    operations: store.operations,
    operationStates: store.operationStates,
    nowMs: base + 11 * 60 * 60 * 1000 + 31 * 60 * 1000
  });

  const dayList = listOperationDays(store.operations, { companyId: '1' }, base + 12 * 60 * 60 * 1000);
  const detail = buildOperationsResponse(store.operations, {
    companyId: '1',
    dateKey: '2026-06-24',
    nowMs: base + 12 * 60 * 60 * 1000
  });

  assert.equal(store.operations.length, 2);
  assert.equal(dayList.length, 1);
  assert.equal(dayList[0].summary.operationsCount, 2);
  assert.equal(dayList[0].summary.totalFlights, 2);
  assert.equal(dayList[0].summary.totalHectares, 30.8);
  assert.equal(detail.operations[0].pilotName, 'Gabriel');
  assert.equal(detail.summary.totalOperationLabel, '8h 00min');
});

test('migra stores antigos garantindo schema de operações', () => {
  const migrated = migrateStoreData({
    users: [{ id: '1' }],
    companies: null,
    drones: 'invalid',
    farms: [],
    operations: [{ id: 'op-1' }]
  });

  assert.deepEqual(migrated.users, [{ id: '1' }]);
  assert.deepEqual(migrated.companies, []);
  assert.deepEqual(migrated.drones, []);
  assert.equal(Array.isArray(migrated.operations), true);
  assert.equal(typeof migrated.operationStates, 'object');
});