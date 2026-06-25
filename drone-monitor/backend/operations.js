const OPERATION_INACTIVITY_MS = 30 * 60 * 1000;
const DEFAULT_TIME_ZONE = process.env.OPERATION_TIMEZONE || 'America/Sao_Paulo';

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getOperationDateParts(timestampMs, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const dateKey = `${year}-${month}-${day}`;
  return { dateKey, dateLabel: formatDateKeyToLabel(dateKey) };
}

function formatDateKeyToLabel(dateKey) {
  const [year, month, day] = String(dateKey).split('-');
  if (!year || !month || !day) return dateKey;
  return `${day}/${month}/${year}`;
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  return `${minutes}min`;
}

function ensureOperationState(operationStates, droneCode) {
  if (!operationStates[droneCode]) {
    operationStates[droneCode] = {
      droneCode,
      currentOperationId: null,
      inFlight: false,
      lastAltitude: null,
      lastHectaresApplied: null,
      lastTelemetryAt: null,
      lastLandingAt: null,
      lastTakeoffAt: null,
      lastPilotName: null,
      lastFarmName: null
    };
  }
  return operationStates[droneCode];
}

function getOperationById(operations, operationId) {
  if (!operationId) return null;
  return operations.find((operation) => operation.id === operationId) || null;
}

function createOperationRecord({ operations, droneCode, droneId, companyId, telemetryAtMs, pilotName, farmName, timeZone }) {
  const { dateKey, dateLabel } = getOperationDateParts(telemetryAtMs, timeZone);
  const sequence = operations.filter((operation) => operation.date === dateKey && operation.droneCode === droneCode).length + 1;
  return {
    id: `${droneCode}-${telemetryAtMs}-${sequence}`,
    droneId,
    droneCode,
    companyId,
    date: dateKey,
    dateLabel,
    startedAt: new Date(telemetryAtMs).toISOString(),
    endedAt: null,
    lastLandingAt: null,
    lastTelemetryAt: new Date(telemetryAtMs).toISOString(),
    totalFlights: 0,
    totalOperationMs: 0,
    hectaresStart: null,
    hectaresEnd: null,
    hectaresWorked: 0,
    pilotName: pilotName || null,
    farmName: farmName || null,
    status: 'OPEN',
    closeReason: null
  };
}

function updateOperationHectares(operation, state, hectaresApplied) {
  if (hectaresApplied === null) return false;
  let changed = false;
  if (operation.hectaresStart === null) {
    operation.hectaresStart = hectaresApplied;
    changed = true;
  }
  if (state.lastHectaresApplied !== null) {
    const delta = hectaresApplied - state.lastHectaresApplied;
    if (delta > 0) {
      operation.hectaresWorked = round((operation.hectaresWorked || 0) + delta, 2);
      changed = true;
    }
  }
  if (operation.hectaresEnd !== hectaresApplied) {
    operation.hectaresEnd = hectaresApplied;
    changed = true;
  }
  return changed;
}

function finalizeOperation(operation, state, endedAtMs, closeReason = 'inactivity_after_landing') {
  if (!operation || operation.status === 'CLOSED') return false;
  operation.endedAt = new Date(endedAtMs).toISOString();
  operation.totalOperationMs = Math.max(0, endedAtMs - Date.parse(operation.startedAt));
  operation.status = 'CLOSED';
  operation.closeReason = closeReason;
  state.currentOperationId = null;
  state.inFlight = false;
  return true;
}

function closeInactiveOperations({ operations, operationStates, nowMs = Date.now() }) {
  let changed = false;
  for (const state of Object.values(operationStates)) {
    if (!state || !state.currentOperationId) continue;
    const operation = getOperationById(operations, state.currentOperationId);
    if (!operation) {
      state.currentOperationId = null;
      changed = true;
      continue;
    }
    const lastLandingAtMs = Number(state.lastLandingAt);
    if (!state.inFlight && Number.isFinite(lastLandingAtMs) && nowMs - lastLandingAtMs >= OPERATION_INACTIVITY_MS) {
      if (finalizeOperation(operation, state, lastLandingAtMs, 'inactivity_after_landing')) changed = true;
      continue;
    }
    const lastTelemetryAtMs = Number(state.lastTelemetryAt);
    if (state.inFlight && Number.isFinite(lastTelemetryAtMs) && nowMs - lastTelemetryAtMs >= OPERATION_INACTIVITY_MS) {
      state.lastLandingAt = lastTelemetryAtMs;
      if (finalizeOperation(operation, state, lastTelemetryAtMs, 'connection_timeout')) changed = true;
    }
  }
  return changed;
}

function processTelemetryForOperations({
  operations,
  operationStates,
  droneCode,
  droneId,
  companyId,
  telemetry,
  telemetryAtMs,
  pilotName,
  farmName,
  timeZone = DEFAULT_TIME_ZONE
}) {
  const state = ensureOperationState(operationStates, droneCode);
  let changed = closeInactiveOperations({ operations, operationStates: { [droneCode]: state }, nowMs: telemetryAtMs });
  let currentOperation = getOperationById(operations, state.currentOperationId);
  const altitude = normalizeNumber(telemetry.altitude);
  const hectaresApplied = normalizeNumber(telemetry.hectaresApplied);
  const isFlightStartSignal = altitude !== null && altitude > 1;
  const isFlightEndSignal = altitude === null || altitude <= 0;

  if (currentOperation) {
    currentOperation.lastTelemetryAt = new Date(telemetryAtMs).toISOString();
    if (pilotName && currentOperation.pilotName !== pilotName) {
      currentOperation.pilotName = pilotName;
      changed = true;
    }
    if (farmName && currentOperation.farmName !== farmName) {
      currentOperation.farmName = farmName;
      changed = true;
    }
    if (updateOperationHectares(currentOperation, state, hectaresApplied)) changed = true;
  }

  if (isFlightStartSignal && !state.inFlight) {
    if (!currentOperation) {
      currentOperation = createOperationRecord({
        operations,
        droneCode,
        droneId,
        companyId,
        telemetryAtMs,
        pilotName,
        farmName,
        timeZone
      });
      operations.push(currentOperation);
      state.currentOperationId = currentOperation.id;
      changed = true;
      if (updateOperationHectares(currentOperation, state, hectaresApplied)) changed = true;
    }
    currentOperation.totalFlights += 1;
    currentOperation.lastTelemetryAt = new Date(telemetryAtMs).toISOString();
    state.inFlight = true;
    state.lastTakeoffAt = telemetryAtMs;
    changed = true;
  }

  if (isFlightEndSignal && state.inFlight) {
    state.inFlight = false;
    state.lastLandingAt = telemetryAtMs;
    currentOperation = getOperationById(operations, state.currentOperationId);
    if (currentOperation) {
      currentOperation.lastLandingAt = new Date(telemetryAtMs).toISOString();
      currentOperation.lastTelemetryAt = new Date(telemetryAtMs).toISOString();
      if (updateOperationHectares(currentOperation, state, hectaresApplied)) changed = true;
    }
    changed = true;
  }

  state.lastAltitude = altitude;
  state.lastTelemetryAt = telemetryAtMs;
  state.lastPilotName = pilotName || state.lastPilotName;
  state.lastFarmName = farmName || state.lastFarmName;
  if (hectaresApplied !== null) state.lastHectaresApplied = hectaresApplied;

  return { changed, state, currentOperationId: state.currentOperationId };
}

function getOperationDurationMs(operation, nowMs = Date.now()) {
  if (operation.totalOperationMs > 0) return operation.totalOperationMs;
  if (operation.status === 'CLOSED' && operation.endedAt) {
    return Math.max(0, Date.parse(operation.endedAt) - Date.parse(operation.startedAt));
  }
  return Math.max(0, nowMs - Date.parse(operation.startedAt));
}

function serializeOperation(operation, nowMs = Date.now()) {
  const durationMs = getOperationDurationMs(operation, nowMs);
  return {
    ...operation,
    durationMs,
    durationLabel: formatDuration(durationMs),
    hectaresWorked: round(operation.hectaresWorked || 0, 2)
  };
}

function filterOperations(operations, { companyId = null, dateKey = null, droneFilter = null } = {}) {
  return operations.filter((operation) => {
    if (companyId && operation.companyId !== companyId) return false;
    if (dateKey && operation.date !== dateKey) return false;
    if (droneFilter && operation.droneCode !== droneFilter && operation.droneId !== droneFilter) return false;
    return true;
  });
}

function buildDaySummary(operations, nowMs = Date.now()) {
  if (!operations.length) {
    return {
      operationsCount: 0,
      totalFlights: 0,
      totalOperationMs: 0,
      totalOperationLabel: '0min',
      totalHectares: 0,
      lastOperationAt: null,
      lastOperationLabel: null
    };
  }
  const totalOperationMs = operations.reduce((sum, operation) => sum + getOperationDurationMs(operation, nowMs), 0);
  const totalFlights = operations.reduce((sum, operation) => sum + (operation.totalFlights || 0), 0);
  const totalHectares = round(operations.reduce((sum, operation) => sum + (operation.hectaresWorked || 0), 0), 2);
  const sorted = [...operations].sort((left, right) => {
    const leftTime = Date.parse(left.endedAt || left.lastLandingAt || left.lastTelemetryAt || left.startedAt);
    const rightTime = Date.parse(right.endedAt || right.lastLandingAt || right.lastTelemetryAt || right.startedAt);
    return rightTime - leftTime;
  });
  const lastOperationAt = sorted[0]?.endedAt || sorted[0]?.lastLandingAt || sorted[0]?.lastTelemetryAt || sorted[0]?.startedAt || null;
  return {
    operationsCount: operations.length,
    totalFlights,
    totalOperationMs,
    totalOperationLabel: formatDuration(totalOperationMs),
    totalHectares,
    lastOperationAt,
    lastOperationLabel: lastOperationAt ? new Date(lastOperationAt).toLocaleString('pt-BR') : null
  };
}

function listOperationDays(operations, filters = {}, nowMs = Date.now()) {
  const filtered = filterOperations(operations, filters);
  const grouped = new Map();
  for (const operation of filtered) {
    const list = grouped.get(operation.date) || [];
    list.push(operation);
    grouped.set(operation.date, list);
  }
  return Array.from(grouped.entries())
    .map(([date, dayOperations]) => ({
      date,
      dateLabel: formatDateKeyToLabel(date),
      summary: buildDaySummary(dayOperations, nowMs)
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function buildOperationsResponse(operations, { dateKey, companyId = null, droneFilter = null, nowMs = Date.now() } = {}) {
  const filtered = filterOperations(operations, { companyId, dateKey, droneFilter }).sort((left, right) => {
    return Date.parse(left.startedAt) - Date.parse(right.startedAt);
  });
  return {
    date: dateKey,
    dateLabel: dateKey ? formatDateKeyToLabel(dateKey) : null,
    summary: buildDaySummary(filtered, nowMs),
    operations: filtered.map((operation) => serializeOperation(operation, nowMs))
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  OPERATION_INACTIVITY_MS,
  buildOperationsResponse,
  buildDaySummary,
  closeInactiveOperations,
  formatDateKeyToLabel,
  formatDuration,
  getOperationDateParts,
  listOperationDays,
  processTelemetryForOperations
};