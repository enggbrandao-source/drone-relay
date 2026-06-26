const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ESRI_WORLD_IMAGERY_LAYER,
  GOOGLE_HYBRID_LAYER,
  GOOGLE_SATELLITE_LAYER,
  OPEN_STREET_MAP_LAYER,
  getBaseLayerNames,
  getDefaultBaseLayer,
  getLayerNotice
} = require('../mapLayers');

test('retorna todas as camadas quando Google está habilitado', () => {
  assert.deepEqual(getBaseLayerNames({ googleEnabled: true }), [
    GOOGLE_HYBRID_LAYER,
    GOOGLE_SATELLITE_LAYER,
    OPEN_STREET_MAP_LAYER,
    ESRI_WORLD_IMAGERY_LAYER
  ]);
});

test('retorna apenas camadas disponíveis no fallback sem Google', () => {
  assert.deepEqual(getBaseLayerNames({ googleEnabled: false }), [
    OPEN_STREET_MAP_LAYER,
    ESRI_WORLD_IMAGERY_LAYER
  ]);
});

test('define Google Hybrid como camada padrão quando disponível', () => {
  assert.equal(getDefaultBaseLayer({ googleEnabled: true }), GOOGLE_HYBRID_LAYER);
});

test('define Esri World Imagery como camada padrão no fallback', () => {
  assert.equal(getDefaultBaseLayer({ googleEnabled: false }), ESRI_WORLD_IMAGERY_LAYER);
});

test('exibe aviso para configuração ausente da API key', () => {
  assert.equal(
    getLayerNotice({ apiKeyConfigured: false, googleEnabled: false }),
    'Google Hybrid será habilitado automaticamente quando a API Key oficial do Google Maps for configurada.'
  );
});

test('exibe aviso quando a API key existe mas o Google Hybrid falha', () => {
  assert.equal(
    getLayerNotice({ apiKeyConfigured: true, googleEnabled: false }),
    'Google Hybrid indisponível no momento. Exibindo Esri World Imagery com referências geográficas.'
  );
});

test('não exibe aviso quando Google Hybrid está ativo', () => {
  assert.equal(getLayerNotice({ apiKeyConfigured: true, googleEnabled: true }), '');
});