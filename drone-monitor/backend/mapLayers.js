const GOOGLE_HYBRID_LAYER = 'Google Hybrid';
const GOOGLE_SATELLITE_LAYER = 'Google Satellite';
const OPEN_STREET_MAP_LAYER = 'OpenStreetMap';
const ESRI_WORLD_IMAGERY_LAYER = 'Esri World Imagery';

function getBaseLayerNames(options = {}) {
  const { googleEnabled = false } = options;
  const names = [];

  if (googleEnabled) {
    names.push(GOOGLE_HYBRID_LAYER, GOOGLE_SATELLITE_LAYER);
  }

  names.push(OPEN_STREET_MAP_LAYER, ESRI_WORLD_IMAGERY_LAYER);
  return names;
}

function getDefaultBaseLayer(options = {}) {
  const { googleEnabled = false } = options;
  return googleEnabled ? GOOGLE_HYBRID_LAYER : ESRI_WORLD_IMAGERY_LAYER;
}

function getLayerNotice(options = {}) {
  const { apiKeyConfigured = false, googleEnabled = false } = options;

  if (!apiKeyConfigured) {
    return 'Google Hybrid será habilitado automaticamente quando a API Key oficial do Google Maps for configurada.';
  }

  if (!googleEnabled) {
    return 'Google Hybrid indisponível no momento. Exibindo Esri World Imagery com referências geográficas.';
  }

  return '';
}

module.exports = {
  ESRI_WORLD_IMAGERY_LAYER,
  GOOGLE_HYBRID_LAYER,
  GOOGLE_SATELLITE_LAYER,
  OPEN_STREET_MAP_LAYER,
  getBaseLayerNames,
  getDefaultBaseLayer,
  getLayerNotice
};