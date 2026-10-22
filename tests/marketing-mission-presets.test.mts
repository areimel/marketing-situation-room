import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MAP_LAYERS, getInitialPanelSettingsForVariant } from '../src/config/panels.ts';
import {
  applyMissionPresetToState,
  getMissionPresetsForVariant,
} from '../src/services/mission-presets.ts';

const MARKETING_PRESET_IDS = ['marketing-overview', 'marketing-client-focus', 'marketing-storm-watch'];

describe('marketing mission presets', () => {
  it('offers exactly the three marketing presets on the marketing variant, overview first', () => {
    assert.deepEqual(
      getMissionPresetsForVariant('marketing').map((preset) => preset.id),
      MARKETING_PRESET_IDS,
    );
  });

  it('keeps marketing presets out of the full variant', () => {
    const fullIds = getMissionPresetsForVariant('full').map((preset) => preset.id);
    for (const id of MARKETING_PRESET_IDS) assert.equal(fullIds.includes(id), false, id);
  });

  it('leaves the full variant preset count unchanged', () => {
    assert.equal(getMissionPresetsForVariant('full').length, 8);
  });

  it('applies storm watch on the marketing variant with NWS alerts on', () => {
    const applied = applyMissionPresetToState(
      'marketing-storm-watch',
      getInitialPanelSettingsForVariant('marketing'),
      DEFAULT_MAP_LAYERS,
      'marketing',
    );
    assert.equal(applied.mapLayers.nwsAlerts, true);
    const enabled = Object.values(applied.panelSettings).filter((config) => config.enabled);
    assert.ok(enabled.length >= 2, `expected at least 2 enabled panels, got ${enabled.length}`);
  });
});
