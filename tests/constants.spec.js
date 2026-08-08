import { test, expect } from '@playwright/test';
import * as constants from '../src/core/constants.js';

test.describe('Constants', () => {
  test('should export phase constants', () => {
    expect(constants.PHASE_ALPHA).toBe(0);
    expect(constants.PHASE_BETA).toBe(1);
    expect(constants.PHASE_GAMMA).toBe(2);
    expect(constants.PHASE_COUNT).toBe(3);
  });

  test('should define block types', () => {
    expect(constants.BLOCK_AIR).toBe(0);
    expect(constants.BLOCK_STONE).toBe(1);
    expect(constants.BLOCK_CRYSTAL).toBe(3);
  });

  test('should have block properties defined', () => {
    expect(constants.BLOCK_PROPERTIES[constants.BLOCK_STONE]).toBeTruthy();
    expect(constants.BLOCK_PROPERTIES[constants.BLOCK_CRYSTAL]).toBeTruthy();
    expect(constants.BLOCK_PROPERTIES[constants.BLOCK_VOID]).toBeTruthy();
  });

  test('should have biome definitions', () => {
    expect(constants.BIOME_FOREST).toBe(1);
    expect(constants.BIOME_CAVES).toBe(2);
    expect(constants.BIOME_DEEP_VOID).toBe(3);
  });
});
