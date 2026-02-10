import { describe, it, expect } from 'vitest';
import { calculateCost, getModelPricing, loadPricing, getAllPricing } from './pricingService.js';

describe('loadPricing', () => {
  it('loads pricing data from CSV without throwing', () => {
    expect(() => loadPricing()).not.toThrow();
  });

  it('populates pricing cache', () => {
    loadPricing();
    const all = getAllPricing();
    expect(all.length).toBeGreaterThan(0);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for known model (exact match)', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).not.toBeNull();
    expect(pricing!.inputPer1M).toBeGreaterThan(0);
    expect(pricing!.outputPer1M).toBeGreaterThan(0);
  });

  it('returns pricing via prefix match', () => {
    // gpt-4o-2024-... should match gpt-4o
    const pricing = getModelPricing('gpt-4o-2024-08-06');
    expect(pricing).not.toBeNull();
  });

  it('returns null for unknown model', () => {
    const pricing = getModelPricing('totally-unknown-model-xyz-999');
    expect(pricing).toBeNull();
  });
});

describe('calculateCost', () => {
  it('calculates cost for known model', () => {
    const result = calculateCost(1_000_000, 500_000, 'gpt-4o');
    expect(result.inputCost).toBeGreaterThan(0);
    expect(result.outputCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(result.inputCost + result.outputCost + result.webSearchCost);
    expect(result.pricing).not.toBeNull();
  });

  it('returns zero web search cost when not used', () => {
    const result = calculateCost(1000, 1000, 'gpt-4o', false);
    expect(result.webSearchCost).toBe(0);
  });

  it('adds web search cost when used', () => {
    const result = calculateCost(1000, 1000, 'gpt-4o', true);
    expect(result.webSearchCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(result.inputCost + result.outputCost + result.webSearchCost);
  });

  it('uses default rates for unknown models', () => {
    const result = calculateCost(1_000_000, 1_000_000, 'unknown-model-xyz');
    expect(result.pricing).toBeNull();
    // Should still calculate with fallback rates
    expect(result.inputCost).toBeGreaterThan(0);
    expect(result.outputCost).toBeGreaterThan(0);
  });

  it('returns zero cost for zero tokens', () => {
    const result = calculateCost(0, 0, 'gpt-4o');
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it('scales linearly with token count', () => {
    const result1 = calculateCost(1_000_000, 0, 'gpt-4o');
    const result2 = calculateCost(2_000_000, 0, 'gpt-4o');
    expect(result2.inputCost).toBeCloseTo(result1.inputCost * 2, 10);
  });
});
